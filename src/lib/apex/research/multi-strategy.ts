/**
 * Research-side multi-strategy decision engine.
 * Scores are eligibility ranks, not win probabilities.
 * No strategy is approved. Nothing here can submit an order.
 */

export const LOGICAL_ROLES = [
  "Scout", "Vector", "Atlas", "Oracle", "Pulse", "Volta",
  "Bull", "Bear", "Sigma", "Sentinel", "Allocator", "Pilot", "Hermes",
  "Apex Executor", "Apex Warden",
] as const;

export type Regime = "TREND" | "RANGE" | "HIGH_VOL" | "UNKNOWN";

export interface RegisteredStrategy {
  id: string;
  version: string;
  entry: string;
  exit: string;
  regimes: Regime[];
  dataRequirements: string[];
  validationVerdict: "NO_WINNER" | "INSUFFICIENT" | "SYNTHETIC_FIXTURE";
  approved: false;
  brokerExecutable: false;
}

export const STRATEGY_REGISTRY: Record<string, RegisteredStrategy> = {
  "etf-xs-breakout-20-v1": {
    id: "etf-xs-breakout-20-v1", version: "etf-xs-breakout-20-v1",
    entry: "20-day breakout above 200-SMA", exit: "10-day low or 50-SMA",
    regimes: ["TREND"], dataRequirements: ["bars", "spy"],
    validationVerdict: "NO_WINNER", approved: false, brokerExecutable: false,
  },
  "etf-weekly-momentum-v1": {
    id: "etf-weekly-momentum-v1", version: "etf-weekly-momentum-v1",
    entry: "weekly rank among SPY QQQ IWM", exit: "rank loss or trend break",
    regimes: ["TREND"], dataRequirements: ["bars", "spy"],
    validationVerdict: "NO_WINNER", approved: false, brokerExecutable: false,
  },
  "synthetic-eligible-fixture": {
    id: "synthetic-eligible-fixture", version: "synthetic-eligible-fixture",
    entry: "test fixture only", exit: "test fixture only",
    regimes: ["TREND", "RANGE", "HIGH_VOL"], dataRequirements: ["bars"],
    validationVerdict: "SYNTHETIC_FIXTURE", approved: false, brokerExecutable: false,
  },
};

export interface EvidencePacket {
  role: string;
  timestamp: string;
  provenance: string;
  confidence: number | null;
  missing: boolean;
  relevantStrategies: string[];
  output: Record<string, unknown>;
  status: "ACTIVE" | "BLOCKED" | "UNAVAILABLE" | "STALE";
}

export interface MarketSnapshot {
  symbol: "SPY" | "QQQ" | "IWM";
  asOf: string;
  close: number;
  sma200: number | null;
  vol20: number | null;
  dataAgeMs: number;
  macroPresent: boolean;
  positioningPresent: boolean;
  ownedQty: number;
  correlatedExposure: number;
}

export interface DecisionPacket {
  recommendation: "BUY" | "EXIT" | "NO_TRADE";
  regime: Regime;
  eligible: string[];
  rejected: { id: string; reason: string }[];
  ranking: { baseline: string | null; scored: string | null; score: number | null; scoreIsProbability: false };
  evidence: EvidencePacket[];
  sigmaVeto: boolean;
  sentinelVeto: boolean;
  sizedNotional: number | null;
  pilot: { source: "RESEARCH_PROPOSAL"; executable: false; strategyApproved: false; operatorProof: null };
  hermes: { strategyVersion: string | null; regime: Regime; realPerformance: false };
  warden: string[];
  reason: string;
}

const STALE_MS = 15 * 60 * 1000;

export function classifyRegime(m: MarketSnapshot): Regime {
  if (m.sma200 == null || m.vol20 == null) return "UNKNOWN";
  if (m.vol20 > 0.02) return "HIGH_VOL";
  if (m.close > m.sma200) return "TREND";
  return "RANGE";
}

function packet(role: string, m: MarketSnapshot, missing: boolean, status: EvidencePacket["status"], output: Record<string, unknown>): EvidencePacket {
  return {
    role, timestamp: m.asOf, provenance: "research-snapshot", confidence: missing ? null : 1,
    missing, relevantStrategies: Object.keys(STRATEGY_REGISTRY), output, status,
  };
}

export function evaluate(m: MarketSnapshot, signals: Record<string, "BUY" | "EXIT" | "WAIT">, opts: {
  billingLocked?: boolean;
  bull?: "BUY" | "NO";
  bear?: "BUY" | "NO";
  timeoutRoles?: string[];
} = {}): DecisionPacket {
  const billingLocked = opts.billingLocked !== false;
  const regime = classifyRegime(m);
  const stale = m.dataAgeMs > STALE_MS;
  const warden: string[] = [];
  if (stale) warden.push("stale market data");
  if (!m.macroPresent) warden.push("missing macro");
  if (!m.positioningPresent) warden.push("missing positioning");
  const evidence = [
    packet("Scout", m, false, "ACTIVE", { symbol: m.symbol }),
    packet("Vector", m, m.sma200 == null, m.sma200 == null ? "UNAVAILABLE" : "ACTIVE", { regime }),
    packet("Atlas", m, !m.macroPresent, m.macroPresent ? "ACTIVE" : "UNAVAILABLE", { macro: m.macroPresent }),
    packet("Oracle", m, opts.timeoutRoles?.includes("Oracle") ?? false, opts.timeoutRoles?.includes("Oracle") ? "UNAVAILABLE" : "ACTIVE", {}),
    packet("Pulse", m, opts.timeoutRoles?.includes("Pulse") ?? true, "UNAVAILABLE", {}),
    packet("Volta", m, m.vol20 == null, m.vol20 == null ? "UNAVAILABLE" : "ACTIVE", { vol20: m.vol20 }),
    packet("Bull", m, billingLocked, billingLocked ? "BLOCKED" : "ACTIVE", { view: opts.bull ?? null }),
    packet("Bear", m, billingLocked, billingLocked ? "BLOCKED" : "ACTIVE", { view: opts.bear ?? null }),
  ];
  if (opts.bull && opts.bear && opts.bull !== opts.bear) warden.push("Bull/Bear conflict");
  if (evidence.some((e) => e.status === "UNAVAILABLE")) warden.push("unavailable agent");

  const rejected: { id: string; reason: string }[] = [];
  const eligible: string[] = [];
  for (const s of Object.values(STRATEGY_REGISTRY)) {
    if (s.approved !== false || s.validationVerdict === "NO_WINNER") {
      rejected.push({ id: s.id, reason: s.validationVerdict === "NO_WINNER" ? "unapproved NO_WINNER" : "not approved" });
      continue;
    }
    if (stale) {
      rejected.push({ id: s.id, reason: "stale data" });
      continue;
    }
    if (!s.regimes.includes(regime) && regime !== "UNKNOWN") {
      rejected.push({ id: s.id, reason: "regime mismatch" });
      continue;
    }
    if (signals[s.id] !== "BUY" && signals[s.id] !== "EXIT") {
      rejected.push({ id: s.id, reason: "no signal" });
      continue;
    }
    eligible.push(s.id);
  }

  const protective = m.ownedQty > 0 && Object.values(signals).includes("EXIT");
  const sentinelVeto = stale || regime === "UNKNOWN" || (!m.macroPresent && !protective);
  const sigmaVeto = eligible.every((id) => STRATEGY_REGISTRY[id]!.approved === false) || eligible.length === 0;
  const conflict = m.correlatedExposure > 0.5;
  let recommendation: DecisionPacket["recommendation"] = "NO_TRADE";
  let reason = "no eligible approved strategy";
  if (protective) {
    recommendation = "EXIT";
    reason = "protective exit does not wait for LLM consensus";
  } else if (sentinelVeto || sigmaVeto || conflict) {
    recommendation = "NO_TRADE";
    reason = conflict ? "correlated exposure" : sentinelVeto ? "Sentinel veto" : "Sigma rejects unapproved strategy";
  }

  const scored = eligible[0] ?? null;
  return {
    recommendation,
    regime,
    eligible,
    rejected,
    ranking: { baseline: scored, scored, score: scored ? eligible.length : null, scoreIsProbability: false },
    evidence,
    sigmaVeto: recommendation === "BUY" ? false : true,
    sentinelVeto,
    sizedNotional: recommendation === "NO_TRADE" ? null : Math.min(25, 25 / (1 + m.correlatedExposure)),
    pilot: { source: "RESEARCH_PROPOSAL", executable: false, strategyApproved: false, operatorProof: null },
    hermes: { strategyVersion: scored, regime, realPerformance: false },
    warden,
    reason,
  };
}
