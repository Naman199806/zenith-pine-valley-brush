/**
 * Research-side multi-strategy decision framework.
 * Research eligibility is not trading authorization.
 * Scores are ranks, not probabilities. No order can be submitted from here.
 */

import { STRATEGY_REGISTRY as CANONICAL } from "./canonical-decision.ts";

export const LOGICAL_ROLES = [
  "Scout", "Vector", "Atlas", "Oracle", "Pulse", "Volta",
  "Bull", "Bear", "Sigma", "Sentinel", "Allocator", "Pilot", "Hermes",
  "Apex Executor", "Apex Warden",
] as const;

export type Regime = "TREND" | "RANGE" | "HIGH_VOL" | "UNKNOWN";
export type EvidenceStatus = "ACTUAL_ANALYSIS" | "SYNTHETIC_FIXTURE" | "UNAVAILABLE" | "STALE" | "MISSING_EVIDENCE" | "BLOCKED";

export interface RegisteredStrategy {
  id: string;
  version: string;
  entry: string;
  exit: string;
  regimes: Regime[];
  requiredData: string[];
  optionalData: string[];
  validationVerdict: "NO_WINNER" | "INSUFFICIENT" | "SYNTHETIC_FIXTURE";
  approved: false;
  brokerExecutable: false;
}

const REGISTRY_MUTABLE: Record<string, RegisteredStrategy> = {
  "etf-xs-breakout-20-v1": {
    id: "etf-xs-breakout-20-v1", version: "etf-xs-breakout-20-v1",
    entry: "20-day breakout above 200-SMA", exit: "10-day low or 50-SMA",
    regimes: ["TREND"], requiredData: ["bars", "spy"], optionalData: ["macro"],
    validationVerdict: "NO_WINNER", approved: false, brokerExecutable: false,
  },
  "etf-weekly-momentum-v1": {
    id: "etf-weekly-momentum-v1", version: "etf-weekly-momentum-v1",
    entry: "weekly rank among SPY QQQ IWM", exit: "rank loss or trend break",
    regimes: ["TREND"], requiredData: ["bars", "spy"], optionalData: ["macro"],
    validationVerdict: "NO_WINNER", approved: false, brokerExecutable: false,
  },
  "ir01-sma18-v1": {
    id: "ir01-sma18-v1", version: "ir01-sma18-v1",
    entry: "two SMA18 setup candles then breakout above qualifying highs",
    exit: "opposite qualified SMA18 signal",
    regimes: ["TREND"], requiredData: ["bars", "sma18"], optionalData: ["macro"],
    validationVerdict: "NO_WINNER", approved: false, brokerExecutable: false,
  },
  "synthetic-eligible-fixture": {
    id: "synthetic-eligible-fixture", version: "synthetic-eligible-fixture",
    entry: "test fixture only", exit: "test fixture only",
    regimes: ["TREND", "RANGE", "HIGH_VOL"], requiredData: ["bars"], optionalData: ["macro"],
    validationVerdict: "SYNTHETIC_FIXTURE", approved: false, brokerExecutable: false,
  },
};

function freezeDeep<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

export const STRATEGY_REGISTRY = freezeDeep(REGISTRY_MUTABLE);

export interface EvidencePacket {
  role: string;
  timestamp: string;
  provenance: string;
  confidence: number | null;
  missing: boolean;
  relevantStrategies: string[];
  output: Record<string, unknown>;
  status: EvidenceStatus;
}

export interface MarketSnapshot {
  symbol: "SPY" | "QQQ" | "IWM";
  asOf: string;
  close: number;
  sma200: number | null;
  vol20: number | null;
  dataAgeMs: number;
  present: Record<string, boolean>;
  ownedQty: number;
  ownedSymbol: "SPY" | "QQQ" | "IWM" | null;
  ownedStrategyVersion: string | null;
  correlatedExposure: number;
}

export interface RankRow {
  id: string;
  baseline: number;
  score: number | "NOT_RANKABLE";
  reason: string;
}

export interface DecisionPacket {
  recommendation: "BUY" | "EXIT" | "NO_TRADE";
  tradingAuthorized: false;
  regime: Regime;
  researchEligible: string[];
  rejected: { id: string; reason: string }[];
  ranking: { status: "RANKED" | "NOT_RANKABLE"; rows: RankRow[]; selected: string | null; scoreIsProbability: false };
  evidence: EvidencePacket[];
  sigmaVeto: boolean;
  sentinelVeto: boolean;
  sizedNotional: number | null;
  pilot: { source: "RESEARCH_PROPOSAL"; executable: false; strategyApproved: false; operatorProof: null; strategyVersion: string | null; symbol: string };
  hermes: { strategyVersion: string | null; symbol: string; regime: Regime; realPerformance: false };
  warden: string[];
  reason: string;
}

const STALE_MS = 15 * 60 * 1000;

function finite(n: number): boolean {
  return Number.isFinite(n);
}

export function classifyRegime(m: MarketSnapshot): Regime {
  if (!finite(m.close) || m.sma200 == null || m.vol20 == null || !finite(m.sma200) || !finite(m.vol20)) return "UNKNOWN";
  if (m.vol20 > 0.02) return "HIGH_VOL";
  if (m.close > m.sma200) return "TREND";
  return "RANGE";
}

function packet(role: string, m: MarketSnapshot, status: EvidenceStatus, output: Record<string, unknown>): EvidencePacket {
  return {
    role, timestamp: m.asOf, provenance: status === "ACTUAL_ANALYSIS" ? "computed-from-snapshot" : status,
    confidence: status === "ACTUAL_ANALYSIS" ? 1 : null,
    missing: status === "MISSING_EVIDENCE" || status === "UNAVAILABLE",
    relevantStrategies: Object.keys(STRATEGY_REGISTRY),
    output, status,
  };
}

export function evaluate(m: MarketSnapshot, signals: Record<string, "BUY" | "EXIT" | "WAIT">, opts: {
  billingLocked?: boolean;
  bull?: "BUY" | "NO";
  bear?: "BUY" | "NO";
  timeoutRoles?: string[];
  exitReason?: string;
} = {}): DecisionPacket {
  const warden: string[] = [];
  if (!finite(m.close) || !finite(m.dataAgeMs) || !finite(m.ownedQty) || !finite(m.correlatedExposure) || m.ownedQty < 0 || m.correlatedExposure < 0 || m.correlatedExposure > 1) {
    warden.push("invalid numerical input");
  }
  if (!Number.isFinite(Date.parse(m.asOf))) warden.push("invalid timestamp");
  const stale = m.dataAgeMs > STALE_MS;
  if (stale) warden.push("stale market data");
  if (!m.present.macro) warden.push("missing macro");
  if (!m.present.positioning) warden.push("missing positioning");
  const regime = classifyRegime(m);
  const billingLocked = opts.billingLocked !== false;
  const evidence = [
    packet("Scout", m, m.symbol ? "ACTUAL_ANALYSIS" : "MISSING_EVIDENCE", { symbol: m.symbol }),
    packet("Vector", m, m.sma200 == null ? "MISSING_EVIDENCE" : "ACTUAL_ANALYSIS", { regime, sma200: m.sma200 }),
    packet("Atlas", m, m.present.macro ? "ACTUAL_ANALYSIS" : "MISSING_EVIDENCE", { macro: m.present.macro === true }),
    packet("Oracle", m, opts.timeoutRoles?.includes("Oracle") ? "UNAVAILABLE" : "MISSING_EVIDENCE", {}),
    packet("Pulse", m, "UNAVAILABLE", {}),
    packet("Volta", m, m.vol20 == null ? "MISSING_EVIDENCE" : stale ? "STALE" : "ACTUAL_ANALYSIS", { vol20: m.vol20 }),
    packet("Bull", m, billingLocked ? "BLOCKED" : "ACTUAL_ANALYSIS", { view: opts.bull ?? null }),
    packet("Bear", m, billingLocked ? "BLOCKED" : "ACTUAL_ANALYSIS", { view: opts.bear ?? null }),
  ];
  if (opts.bull && opts.bear && opts.bull !== opts.bear) warden.push("Bull/Bear conflict");
  if (evidence.some((e) => e.status === "UNAVAILABLE")) warden.push("unavailable agent");

  const rejected: { id: string; reason: string }[] = [];
  const researchEligible: string[] = [];
  const rows: RankRow[] = [];
  for (const [id, signal] of Object.entries(signals)) {
    const local = STRATEGY_REGISTRY[id];
    const canonical = CANONICAL[id];
    if (!local) {
      rejected.push({ id, reason: "unknown strategy" });
      continue;
    }
    if ((canonical && (canonical.approved !== false || canonical.verdict === "NO_WINNER")) || local.validationVerdict === "NO_WINNER") {
      rejected.push({ id, reason: "unapproved NO_WINNER" });
      continue;
    }
    const missingRequired = local.requiredData.filter((key) => m.present[key] !== true);
    if (missingRequired.length) {
      rejected.push({ id, reason: `missing required ${missingRequired.join(",")}` });
      continue;
    }
    if (stale) {
      rejected.push({ id, reason: "stale data" });
      continue;
    }
    if (regime === "UNKNOWN" || !local.regimes.includes(regime)) {
      rejected.push({ id, reason: "regime mismatch" });
      continue;
    }
    if (signal !== "BUY" && signal !== "EXIT") {
      rejected.push({ id, reason: "no signal" });
      continue;
    }
    researchEligible.push(id);
    const optionalMissing = local.optionalData.some((key) => m.present[key] !== true);
    rows.push({
      id,
      baseline: 1,
      score: optionalMissing || m.vol20 == null ? "NOT_RANKABLE" : Number((signal === "BUY" ? 1 : 0.5).toFixed(6)),
      reason: optionalMissing ? "optional evidence missing; not treated as verified" : `strategy-specific ${id} signal rank`,
    });
  }
  rows.sort((a, b) => a.id.localeCompare(b.id));
  const rankable = rows.every((row) => row.score !== "NOT_RANKABLE");
  const selected = rankable && rows.length ? [...rows].sort((a, b) => Number(b.score) - Number(a.score) || a.id.localeCompare(b.id))[0]!.id : null;

  const protectiveCandidate = m.ownedQty > 0 && m.ownedSymbol === m.symbol && m.ownedStrategyVersion && signals[m.ownedStrategyVersion] === "EXIT";
  const protective = Boolean(protectiveCandidate && opts.exitReason === "risk-reduction" && STRATEGY_REGISTRY[m.ownedStrategyVersion!]);
  if (m.ownedQty > 0 && signals[m.ownedStrategyVersion ?? ""] === "EXIT" && !protective) warden.push("exit rejected: not bound to owned position");
  const sentinelVeto = stale || regime === "UNKNOWN" || warden.includes("invalid numerical input") || (!m.present.macro && !protective);
  const conflict = m.correlatedExposure > 0.5;
  let recommendation: DecisionPacket["recommendation"] = "NO_TRADE";
  let reason = "no trading authorization; research eligibility is not approval";
  if (protective) {
    recommendation = "EXIT";
    reason = "protective exit bound to owned position; does not wait for LLM consensus";
  } else if (sentinelVeto || conflict || researchEligible.length === 0) {
    recommendation = "NO_TRADE";
    reason = conflict ? "correlated exposure" : sentinelVeto ? "Sentinel veto" : "Sigma rejects unapproved or ineligible strategy";
  }

  return {
    recommendation,
    tradingAuthorized: false,
    regime,
    researchEligible,
    rejected,
    ranking: { status: rankable && rows.length ? "RANKED" : "NOT_RANKABLE", rows, selected, scoreIsProbability: false },
    evidence,
    sigmaVeto: true,
    sentinelVeto,
    sizedNotional: recommendation === "EXIT" ? null : null,
    pilot: { source: "RESEARCH_PROPOSAL", executable: false, strategyApproved: false, operatorProof: null, strategyVersion: selected, symbol: m.symbol },
    hermes: { strategyVersion: m.ownedStrategyVersion, symbol: m.symbol, regime, realPerformance: false },
    warden,
    reason,
  };
}
