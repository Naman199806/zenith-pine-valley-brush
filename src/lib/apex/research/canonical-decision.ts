/**
 * Narrow correction to the canonical decision pipeline.
 * Vector computes the frozen signal from point-in-time bars.
 * Sigma reads the strategy registry. etf-xs-breakout-20-v1 is NO_WINNER
 * and can never produce a strategy-driven BUY.
 * Eligible BUY tests must use the labeled synthetic fixture.
 * EXIT of a verified owned position is allowed even if the entry strategy is rejected.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const ROLES = [
  "Scout", "Vector", "Atlas", "Oracle", "Pulse", "Volta",
  "Bull", "Bear", "Sigma", "Sentinel", "Allocator", "Pilot", "Hermes",
] as const;

export type Role = (typeof ROLES)[number];
export type Contribution = "CHANGED_DECISION" | "ADVISORY_ONLY" | "UNAVAILABLE" | "BLOCKED" | "VETO" | "NOT_RUN";

export interface Bar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface RoleTrace {
  role: Role;
  invoked: boolean;
  mode: "DETERMINISTIC" | "BLOCKED" | "UNAVAILABLE" | "NOT_APPLICABLE" | "NOT_RUN";
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  contribution: Contribution;
  effect: string;
}

export const STRATEGY_REGISTRY: Record<string, { verdict: string; approved: boolean; label: string }> = {
  "etf-xs-breakout-20-v1": { verdict: "NO_WINNER", approved: false, label: "rejected historical strategy" },
  "synthetic-eligible-fixture": { verdict: "SYNTHETIC_FIXTURE", approved: true, label: "TEST ONLY. Not a real or approved strategy." },
};

export interface PipelineInput {
  strategyVersion: string;
  symbol: string;
  bars: Bar[];
  spyBars: Bar[];
  asOf: string;
  provenance: string;
  dataOk: boolean;
  ownedQty: number;
  filledQty: number;
  openExitQty: number;
  proposedNotional: number;
  journalPath?: string;
  disabled?: Role[];
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
  hermes: { recorded: boolean; persistence: "persistent" | "in-memory"; clientOrderId: string | null };
}

function avg(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Point-in-time. Channel excludes the last bar. No future bars are read. */
export function computeVectorSignal(bars: Bar[], spyBars: Bar[]): "BUY" | "EXIT" | "WAIT" {
  if (bars.length < 201 || spyBars.length < 201) return "WAIT";
  const close = bars[bars.length - 1]!.close;
  const channel = Math.max(...bars.slice(-21, -1).map((b) => b.close));
  const sma200 = avg(bars.slice(-200).map((b) => b.close));
  const spyClose = spyBars[spyBars.length - 1]!.close;
  const spySma = avg(spyBars.slice(-200).map((b) => b.close));
  const priorLow = Math.min(...bars.slice(-11, -1).map((b) => b.low));
  const sma50 = avg(bars.slice(-50).map((b) => b.close));
  if (close < priorLow || close < sma50) return "EXIT";
  if (spyClose > spySma && close > channel && close > sma200) return "BUY";
  return "WAIT";
}

function trace(role: Role, invoked: boolean, mode: RoleTrace["mode"], input: Record<string, unknown>, output: Record<string, unknown>, contribution: Contribution, effect: string): RoleTrace {
  return { role, invoked, mode, input, output, contribution, effect };
}

export function runCanonicalDecision(p: PipelineInput, billingLocked = true): DecisionTrace {
  const off = new Set(p.disabled ?? []);
  const roles: RoleTrace[] = [];

  const inUniverse = ["SPY", "QQQ", "IWM"].includes(p.symbol);
  if (off.has("Scout")) roles.push(trace("Scout", false, "NOT_RUN", {}, {}, "NOT_RUN", "ablated"));
  else roles.push(trace("Scout", true, "DETERMINISTIC", { symbol: p.symbol }, { inUniverse }, "ADVISORY_ONLY", "universe check"));

  let signal: "BUY" | "EXIT" | "WAIT" = "WAIT";
  if (off.has("Vector")) roles.push(trace("Vector", false, "NOT_RUN", {}, {}, "NOT_RUN", "ablated; no caller signal accepted"));
  else {
    signal = computeVectorSignal(p.bars, p.spyBars);
    roles.push(trace("Vector", true, "DETERMINISTIC", { bars: p.bars.length, asOf: p.asOf }, { signal, pointInTime: true }, signal === "WAIT" ? "ADVISORY_ONLY" : "CHANGED_DECISION", "computed from bars; caller signal ignored"));
  }

  roles.push(trace("Atlas", false, "NOT_APPLICABLE", {}, {}, "UNAVAILABLE", "no fundamental adapter"));
  roles.push(trace("Oracle", false, "UNAVAILABLE", {}, {}, "UNAVAILABLE", "macro feed not bound"));
  roles.push(trace("Pulse", false, "UNAVAILABLE", { billingLocked }, {}, "UNAVAILABLE", "news not authorized"));
  roles.push(trace("Volta", false, "UNAVAILABLE", {}, {}, "UNAVAILABLE", "derivatives not connected"));
  roles.push(trace("Bull", false, "BLOCKED", { billingLocked }, { inference: false }, "BLOCKED", "billing lock; no paid call"));
  roles.push(trace("Bear", false, "BLOCKED", { billingLocked }, { inference: false }, "BLOCKED", "billing lock; no paid call"));

  const reg = STRATEGY_REGISTRY[p.strategyVersion];
  const sigmaOk = p.dataOk && !!reg && (signal !== "BUY" || reg.approved);
  if (off.has("Sigma")) roles.push(trace("Sigma", false, "NOT_RUN", {}, {}, "NOT_RUN", "ablated"));
  else roles.push(trace("Sigma", true, "DETERMINISTIC", { version: p.strategyVersion, verdict: reg?.verdict ?? "UNREGISTERED", dataOk: p.dataOk }, { veto: !sigmaOk }, sigmaOk ? "ADVISORY_ONLY" : "VETO", reg?.approved ? "registry accepted" : "NO_WINNER or unregistered cannot BUY"));

  const exitQtyOk = signal === "EXIT" ? p.ownedQty > 0 && p.filledQty > 0 && p.filledQty <= p.ownedQty + 1e-9 && p.openExitQty === 0 : true;
  const riskOk = p.proposedNotional > 0 && p.proposedNotional <= 25 && exitQtyOk;
  if (off.has("Sentinel")) roles.push(trace("Sentinel", false, "NOT_RUN", {}, {}, "NOT_RUN", "ablated"));
  else roles.push(trace("Sentinel", true, "DETERMINISTIC", { ownedQty: p.ownedQty, filledQty: p.filledQty, openExitQty: p.openExitQty }, { veto: !riskOk }, riskOk ? "ADVISORY_ONLY" : "VETO", "broker-reconciled quantity and cap"));

  if (off.has("Allocator")) roles.push(trace("Allocator", false, "NOT_RUN", {}, {}, "NOT_RUN", "ablated"));
  else roles.push(trace("Allocator", true, "DETERMINISTIC", { proposed: p.proposedNotional }, { sized: Math.min(25, p.proposedNotional) }, p.proposedNotional > 25 ? "CHANGED_DECISION" : "ADVISORY_ONLY", "$25 cap"));

  let research: DecisionTrace["researchRecommendation"] = "NO_TRADE";
  let reason = "WAIT";
  const sigmaRan = !off.has("Sigma");
  const sentinelRan = !off.has("Sentinel");
  if (sigmaRan && !sigmaOk && signal === "BUY") {
    research = "NO_TRADE";
    reason = reg?.verdict === "NO_WINNER" ? "Sigma: NO_WINNER cannot BUY." : "Sigma veto.";
  } else if (sentinelRan && !riskOk) {
    research = "NO_TRADE";
    reason = "Sentinel veto.";
  } else if (signal === "EXIT" && p.ownedQty > 0 && exitQtyOk) {
    research = "EXIT";
    reason = "Risk-reducing EXIT for verified owned position. Entry strategy approval not required.";
  } else if (signal === "BUY" && reg?.approved && sigmaOk && riskOk) {
    research = "BUY";
    reason = "Synthetic fixture only. Not a real approved strategy. Execution unauthorized.";
  } else {
    research = "NO_TRADE";
    reason = signal === "WAIT" ? "Vector WAIT." : "No qualifying action.";
  }

  roles.push(trace("Pilot", false, "BLOCKED", { research }, { executionAuthorized: false }, "BLOCKED", "LIVE disabled"));

  const clientOrderId = research === "NO_TRADE" ? null : `research-${p.symbol}-${p.asOf}`;
  let persistence: "persistent" | "in-memory" = "in-memory";
  if (p.journalPath && !off.has("Hermes")) {
    mkdirSync(dirname(p.journalPath), { recursive: true });
    appendFileSync(p.journalPath, JSON.stringify({ clientOrderId, research, asOf: p.asOf, symbol: p.symbol }) + "\n");
    persistence = "persistent";
  }
  roles.push(trace("Hermes", !off.has("Hermes"), off.has("Hermes") ? "NOT_RUN" : "DETERMINISTIC", { persistence }, { recorded: !off.has("Hermes"), persistence }, "ADVISORY_ONLY", persistence === "persistent" ? "appended to journal" : "in-memory only; not claimed persistent"));

  return {
    strategyVersion: p.strategyVersion,
    symbol: p.symbol,
    asOf: p.asOf,
    provenance: p.provenance,
    roles,
    quantRejects: sigmaRan && !sigmaOk && signal === "BUY",
    riskRejects: sentinelRan && !riskOk,
    researchRecommendation: research,
    executionAuthorized: false,
    reason,
    hermes: { recorded: !off.has("Hermes"), persistence, clientOrderId },
  };
}
