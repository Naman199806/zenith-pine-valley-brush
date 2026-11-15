/**
 * Final hardening of the canonical decision pipeline.
 * Sigma and Sentinel are mandatory for new entries.
 * Ablation is test-only and cannot authorize production execution.
 * etf-xs-breakout-20-v1 remains NO_WINNER. Synthetic fixtures cannot reach a broker.
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

export const STRATEGY_REGISTRY: Record<string, { verdict: string; approved: boolean; brokerExecutable: false; label: string }> = {
  "etf-xs-breakout-20-v1": { verdict: "NO_WINNER", approved: false, brokerExecutable: false, label: "rejected historical strategy" },
  "synthetic-eligible-fixture": { verdict: "SYNTHETIC_FIXTURE", approved: false, brokerExecutable: false, label: "TEST ONLY. Impossible to authorize for broker execution." },
};

export interface BrokerSnapshot {
  ownedQty: number;
  openExitQty: number;
  asOf: string;
}

export interface PipelineInput {
  strategyVersion: string;
  symbol: string;
  bars: Bar[];
  spyBars: Bar[];
  universe?: Record<string, Bar[]>;
  asOf: string;
  provenance: string;
  dataOk: boolean;
  proposedNotional: number;
  broker: BrokerSnapshot;
  journalPath?: string;
  /** Test-only. Production callers must omit this. */
  ablation?: Role[];
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
  brokerExecutable: false;
  reason: string;
  hermes: { recorded: boolean; persistence: "persistent" | "in-memory"; clientOrderId: string | null };
}

function avg(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function validateBars(bars: Bar[], asOf: string, label: string): string | null {
  if (bars.length === 0) return `${label} has no bars`;
  let prev = "";
  for (const b of bars) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date)) return `${label} invalid date ${b.date}`;
    if (b.date > asOf.slice(0, 10)) return `${label} future bar ${b.date}`;
    if (prev && b.date <= prev) return `${label} not chronological at ${b.date}`;
    if (![b.open, b.high, b.low, b.close].every((n) => Number.isFinite(n) && n > 0)) return `${label} non-finite price`;
    if (b.high < b.low || b.close > b.high || b.close < b.low) return `${label} price integrity`;
    prev = b.date;
  }
  return null;
}

export function align(candidate: Bar[], spy: Bar[]): { candidate: Bar[]; spy: Bar[] } | { error: string } {
  const spyDates = new Set(spy.map((b) => b.date));
  const alignedC = candidate.filter((b) => spyDates.has(b.date));
  const cDates = new Set(alignedC.map((b) => b.date));
  const alignedS = spy.filter((b) => cDates.has(b.date));
  if (alignedC.length < 201 || alignedS.length < 201) return { error: "insufficient aligned bars" };
  if (alignedC.some((b, i) => b.date !== alignedS[i]?.date)) return { error: "alignment mismatch" };
  return { candidate: alignedC, spy: alignedS };
}

/** Frozen spec: 20-day breakout excluding signal day, 200-SMA filter, 60-day rank, 10-day low or 50-SMA exit. */
export function computeVectorSignal(symbol: string, bars: Bar[], spyBars: Bar[], universe: Record<string, Bar[]> = {}): "BUY" | "EXIT" | "WAIT" {
  const aligned = align(bars, spyBars);
  if ("error" in aligned) return "WAIT";
  const c = aligned.candidate;
  const s = aligned.spy;
  const close = c[c.length - 1]!.close;
  const priorLow = Math.min(...c.slice(-11, -1).map((b) => b.low));
  const sma50 = avg(c.slice(-50).map((b) => b.close));
  if (close < priorLow || close < sma50) return "EXIT";
  const spyClose = s[s.length - 1]!.close;
  const spySma = avg(s.slice(-200).map((b) => b.close));
  const channel = Math.max(...c.slice(-21, -1).map((b) => b.close));
  const sma200 = avg(c.slice(-200).map((b) => b.close));
  if (!(spyClose > spySma && close > channel && close > sma200)) return "WAIT";
  const rankOf = (xs: Bar[]) => xs.length >= 61 ? xs[xs.length - 1]!.close / xs[xs.length - 61]!.close - 1 : -Infinity;
  const names = Object.keys(universe).length ? Object.keys(universe) : [symbol];
  let best = symbol;
  let bestRank = rankOf(c);
  for (const name of names) {
    const other = name === symbol ? c : universe[name];
    if (!other) continue;
    const r = rankOf(other);
    if (r > bestRank) { bestRank = r; best = name; }
  }
  return best === symbol ? "BUY" : "WAIT";
}

function tr(role: Role, invoked: boolean, mode: RoleTrace["mode"], input: Record<string, unknown>, output: Record<string, unknown>, contribution: Contribution, effect: string): RoleTrace {
  return { role, invoked, mode, input, output, contribution, effect };
}

export function runCanonicalDecision(p: PipelineInput, billingLocked = true): DecisionTrace {
  const ablated = new Set(p.ablation ?? []);
  const roles: RoleTrace[] = [];
  const reg = STRATEGY_REGISTRY[p.strategyVersion];
  const barErr = validateBars(p.bars, p.asOf, p.symbol) || validateBars(p.spyBars, p.asOf, "SPY");
  const aligned = barErr ? null : align(p.bars, p.spyBars);

  roles.push(ablated.has("Scout")
    ? tr("Scout", false, "NOT_RUN", {}, {}, "NOT_RUN", "test ablation")
    : tr("Scout", true, "DETERMINISTIC", { symbol: p.symbol }, { inUniverse: ["SPY", "QQQ", "IWM"].includes(p.symbol) }, "ADVISORY_ONLY", "universe check"));

  let signal: "BUY" | "EXIT" | "WAIT" = "WAIT";
  if (ablated.has("Vector") || barErr || !aligned || "error" in aligned) {
    roles.push(tr("Vector", !ablated.has("Vector") && !barErr, barErr ? "NOT_RUN" : "DETERMINISTIC", { error: barErr ?? ("error" in (aligned ?? {}) ? (aligned as { error: string }).error : null) }, { signal: "WAIT" }, "ADVISORY_ONLY", "no valid point-in-time signal"));
  } else {
    signal = computeVectorSignal(p.symbol, p.bars, p.spyBars, p.universe);
    roles.push(tr("Vector", true, "DETERMINISTIC", { bars: p.bars.length }, { signal }, signal === "WAIT" ? "ADVISORY_ONLY" : "CHANGED_DECISION", "frozen spec including 60-day rank"));
  }

  for (const [role, effect] of [
    ["Atlas", "no fundamental adapter"],
    ["Oracle", "macro feed not bound"],
    ["Pulse", "news not authorized"],
    ["Volta", "derivatives not connected"],
  ] as const) {
    roles.push(tr(role, false, "UNAVAILABLE", {}, {}, "UNAVAILABLE", effect));
  }
  roles.push(tr("Bull", false, "BLOCKED", { billingLocked }, { inference: false }, "BLOCKED", "billing lock"));
  roles.push(tr("Bear", false, "BLOCKED", { billingLocked }, { inference: false }, "BLOCKED", "billing lock"));

  const sigmaPresent = !ablated.has("Sigma");
  const sigmaOk = sigmaPresent && p.dataOk && !barErr && !!reg && signal !== "BUY";
  roles.push(sigmaPresent
    ? tr("Sigma", true, "DETERMINISTIC", { verdict: reg?.verdict ?? "UNREGISTERED" }, { veto: !sigmaOk || signal === "BUY" }, signal === "BUY" || !sigmaOk ? "VETO" : "ADVISORY_ONLY", "mandatory; no strategy is broker-approved")
    : tr("Sigma", false, "NOT_RUN", {}, { veto: true }, "VETO", "mandatory gate ablated"));

  const exitQty = p.broker.ownedQty;
  const exitOk = signal === "EXIT" && exitQty > 0 && p.broker.openExitQty === 0;
  const entryOk = signal === "BUY" && p.proposedNotional > 0 && p.proposedNotional <= 25;
  const sentinelPresent = !ablated.has("Sentinel");
  const riskOk = sentinelPresent && (signal === "EXIT" ? exitOk : signal === "BUY" ? entryOk : true);
  roles.push(sentinelPresent
    ? tr("Sentinel", true, "DETERMINISTIC", { ownedQty: exitQty, openExitQty: p.broker.openExitQty }, { veto: !riskOk }, riskOk ? "ADVISORY_ONLY" : "VETO", "entry cap separate from exit quantity")
    : tr("Sentinel", false, "NOT_RUN", {}, { veto: true }, "VETO", "mandatory gate ablated"));

  roles.push(ablated.has("Allocator")
    ? tr("Allocator", false, "NOT_RUN", {}, {}, "NOT_RUN", "test ablation")
    : tr("Allocator", true, "DETERMINISTIC", { proposed: p.proposedNotional }, { sized: Math.min(25, p.proposedNotional) }, p.proposedNotional > 25 ? "CHANGED_DECISION" : "ADVISORY_ONLY", "entry cap only"));

  let research: DecisionTrace["researchRecommendation"] = "NO_TRADE";
  let reason = "NO_TRADE";
  if (!sigmaPresent || !sentinelPresent) {
    research = signal === "EXIT" && exitOk && sentinelPresent ? "EXIT" : "NO_TRADE";
    reason = research === "EXIT" ? "Risk-reducing EXIT allowed without entry gate." : "Mandatory Sigma or Sentinel missing. New entry blocked.";
  } else if (signal === "BUY") {
    research = "NO_TRADE";
    reason = reg?.verdict === "NO_WINNER" ? "Sigma: NO_WINNER cannot BUY." : "No broker-approved strategy. Synthetic fixtures cannot be authorized.";
  } else if (signal === "EXIT" && exitOk) {
    research = "EXIT";
    reason = "Risk-reducing EXIT against broker snapshot. Entry cap does not apply.";
  } else if (signal === "EXIT") {
    research = "NO_TRADE";
    reason = p.broker.openExitQty > 0 ? "Duplicate exit blocked." : "EXIT quantity not reconciled.";
  } else {
    reason = "Vector WAIT.";
  }

  roles.push(tr("Pilot", false, "BLOCKED", {}, { executionAuthorized: false, brokerExecutable: false }, "BLOCKED", "LIVE disabled; synthetic fixtures cannot execute"));
  const clientOrderId = research === "NO_TRADE" ? null : `research-${p.symbol}-${p.asOf}`;
  let persistence: "persistent" | "in-memory" = "in-memory";
  if (p.journalPath) {
    mkdirSync(dirname(p.journalPath), { recursive: true });
    appendFileSync(p.journalPath, JSON.stringify({ clientOrderId, research, asOf: p.asOf }) + "\n");
    persistence = "persistent";
  }
  roles.push(tr("Hermes", true, "DETERMINISTIC", { persistence }, { recorded: true }, "ADVISORY_ONLY", persistence));

  return {
    strategyVersion: p.strategyVersion,
    symbol: p.symbol,
    asOf: p.asOf,
    provenance: p.provenance,
    roles,
    quantRejects: signal === "BUY" || !sigmaPresent || !sigmaOk,
    riskRejects: !sentinelPresent || !riskOk,
    researchRecommendation: research,
    executionAuthorized: false,
    brokerExecutable: false,
    reason,
    hermes: { recorded: true, persistence, clientOrderId },
  };
}
