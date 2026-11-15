/**
 * Canonical 13-role decision pipeline.
 * One path for BUY / EXIT / NO_TRADE. Research never overrides Sigma or Sentinel.
 * Bull/Bear remain blocked while the billing lock is active. No paid calls.
 * Execution authorization stays false. strategyApproved stays false.
 */

export const ROLES = [
  "Scout", "Vector", "Atlas", "Oracle", "Pulse", "Volta",
  "Bull", "Bear", "Sigma", "Sentinel", "Allocator", "Pilot", "Hermes",
] as const;

export type Role = (typeof ROLES)[number];
export type Contribution = "CHANGED_DECISION" | "ADVISORY_ONLY" | "UNAVAILABLE" | "BLOCKED" | "VETO";

export interface RoleTrace {
  role: Role;
  invoked: boolean;
  mode: "DETERMINISTIC" | "BLOCKED" | "UNAVAILABLE" | "NOT_APPLICABLE";
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  contribution: Contribution;
  effect: string;
}

export interface StrategyProposal {
  strategyVersion: string;
  symbol: string;
  signal: "BUY" | "EXIT" | "WAIT";
  asOf: string;
  provenance: string;
  dataOk: boolean;
  ownedQty: number;
  filledQty: number;
  openExitQty: number;
  proposedNotional: number;
}

export interface DecisionTrace {
  strategyVersion: string;
  symbol: string;
  asOf: string;
  provenance: string;
  roles: RoleTrace[];
  quantRejects: boolean;
  riskRejects: boolean;
  researchRecommendation: "BUY" | "EXIT" | "NO_TRADE";
  executionAuthorized: false;
  reason: string;
  hermes: { recorded: boolean; clientOrderId: string | null };
}

function role(
  name: Role,
  mode: RoleTrace["mode"],
  input: Record<string, unknown>,
  output: Record<string, unknown>,
  contribution: Contribution,
  effect: string,
): RoleTrace {
  return { role: name, invoked: true, mode, input, output, contribution, effect };
}

export function runCanonicalDecision(p: StrategyProposal, billingLocked = true): DecisionTrace {
  const roles: RoleTrace[] = [];

  roles.push(role("Scout", "DETERMINISTIC", { symbol: p.symbol }, { scanned: true, inUniverse: ["SPY", "QQQ", "IWM"].includes(p.symbol) }, "ADVISORY_ONLY", "confirms symbol is in the frozen universe; does not create the signal"));

  const vectorSignal = p.signal;
  roles.push(role("Vector", "DETERMINISTIC", { asOf: p.asOf, strategyVersion: p.strategyVersion }, { signal: vectorSignal }, vectorSignal === "WAIT" ? "ADVISORY_ONLY" : "CHANGED_DECISION", "supplies the frozen strategy signal"));

  roles.push(role("Atlas", "NOT_APPLICABLE", { symbol: p.symbol }, { stance: "UNAVAILABLE" }, "UNAVAILABLE", "no fundamental source connected"));
  roles.push(role("Oracle", "UNAVAILABLE", {}, { stance: "UNAVAILABLE" }, "UNAVAILABLE", "local macro feed not bound to this equity decision"));
  roles.push(role("Pulse", "UNAVAILABLE", { billingLocked }, { stance: "UNAVAILABLE" }, "UNAVAILABLE", "news/sentiment source not authorized"));
  roles.push(role("Volta", "UNAVAILABLE", { symbol: p.symbol }, { stance: "UNAVAILABLE" }, "UNAVAILABLE", "derivatives feed not connected"));

  roles.push(role("Bull", billingLocked ? "BLOCKED" : "UNAVAILABLE", { billingLocked }, { inference: false }, "BLOCKED", "billing lock active; no paid call; no substitution"));
  roles.push(role("Bear", billingLocked ? "BLOCKED" : "UNAVAILABLE", { billingLocked }, { inference: false }, "BLOCKED", "billing lock active; no paid call; no substitution"));

  const sigmaOk = p.dataOk && p.strategyVersion === "etf-xs-breakout-20-v1";
  roles.push(role("Sigma", "DETERMINISTIC", { dataOk: p.dataOk, version: p.strategyVersion }, { veto: !sigmaOk }, sigmaOk ? "ADVISORY_ONLY" : "VETO", sigmaOk ? "data and version accepted" : "quant veto"));

  const riskOk = p.proposedNotional <= 25 && p.proposedNotional > 0 && (p.signal !== "EXIT" || (p.ownedQty > 0 && p.filledQty <= p.ownedQty + 1e-9 && p.openExitQty === 0));
  roles.push(role("Sentinel", "DETERMINISTIC", { notional: p.proposedNotional, ownedQty: p.ownedQty, filledQty: p.filledQty, openExitQty: p.openExitQty }, { veto: !riskOk }, riskOk ? "ADVISORY_ONLY" : "VETO", riskOk ? "exposure and exit reconciliation accepted" : "risk veto"));

  const sized = Math.min(25, p.proposedNotional);
  roles.push(role("Allocator", "DETERMINISTIC", { proposed: p.proposedNotional }, { sizedNotional: sized }, sized === p.proposedNotional ? "ADVISORY_ONLY" : "CHANGED_DECISION", "enforces $25 cap"));

  let research: DecisionTrace["researchRecommendation"] = "NO_TRADE";
  let reason = "WAIT";
  if (!sigmaOk) {
    research = "NO_TRADE";
    reason = "Sigma veto. Research cannot override.";
  } else if (!riskOk) {
    research = "NO_TRADE";
    reason = "Sentinel veto. Research cannot override.";
  } else if (vectorSignal === "BUY") {
    research = "BUY";
    reason = "Eligible BUY proposal. Execution still unauthorized.";
  } else if (vectorSignal === "EXIT") {
    research = "EXIT";
    reason = "EXIT proposal for owned position. Execution still unauthorized.";
  } else {
    research = "NO_TRADE";
    reason = "Strategy WAIT.";
  }

  roles.push(role("Pilot", "BLOCKED", { research }, { executionAuthorized: false }, "BLOCKED", "LIVE submission disabled; no autonomous authorization"));

  const hermesId = research === "NO_TRADE" ? null : `research-${p.symbol}-${p.asOf}`;
  roles.push(role("Hermes", "DETERMINISTIC", { research }, { recorded: true, clientOrderId: hermesId, submitted: false }, "ADVISORY_ONLY", "records the decision; does not submit"));

  return {
    strategyVersion: p.strategyVersion,
    symbol: p.symbol,
    asOf: p.asOf,
    provenance: p.provenance,
    roles,
    quantRejects: !sigmaOk,
    riskRejects: !riskOk,
    researchRecommendation: research,
    executionAuthorized: false,
    reason,
    hermes: { recorded: true, clientOrderId: hermesId },
  };
}

export function counterfactual(p: StrategyProposal, drop: Role): DecisionTrace {
  const base = runCanonicalDecision(p);
  if (drop === "Vector") {
    return runCanonicalDecision({ ...p, signal: "WAIT" });
  }
  if (drop === "Sigma") {
    return runCanonicalDecision({ ...p, dataOk: true, strategyVersion: "etf-xs-breakout-20-v1" });
  }
  if (drop === "Sentinel") {
    return runCanonicalDecision({ ...p, proposedNotional: 25, openExitQty: 0, ownedQty: Math.max(p.ownedQty, p.signal === "EXIT" ? 1 : p.ownedQty) });
  }
  return base;
}
