import { createHash, randomUUID } from "node:crypto";
import { evaluateFmz, type Bar, type FmzSignal } from "./fmz-bb-rsi.ts";
import { ROLES, type RoleId } from "./roles.ts";

export const FROZEN_RULES_SHA256 = "e68c0a76f04a73ac2ec856e8bf1c4552e7ded96ef27bfb133ce70d95b0fd4cd6";

export interface AgentRecord {
  role: RoleId;
  status: "DETERMINISTIC" | "SKIPPED" | "FAILED";
  invoked: boolean;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  functionUsed: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  effect: "NONE" | "ADVISORY" | "VETO" | "JOURNAL";
  error: string | null;
}

export interface MissionTrace {
  traceId: string;
  evaluatedAt: string;
  market: { source: string; symbol: string; timeframe: string; latestCompletedCandle: string | null; completedBars: number; missing: string | null };
  strategy: { id: string; hash: string; hashMatch: boolean };
  agents: AgentRecord[];
  sigma: "PASS" | "REJECT" | "NOT_RUN";
  sentinel: "PASS" | "VETO" | "NOT_RUN";
  sentinelReasons: string[];
  allocator: Record<string, unknown>;
  finalDecision: "BUY" | "EXIT" | "NO_TRADE";
  pilot: "DRY_RUN" | "BLOCKED";
  hermes: "SAVED" | "FAILED";
  aiModelCalls: number;
  brokerWrites: number;
  flags: { LIVE: false; PAPER_AUTO: false; strategyApproved: false; billingLock: true };
}

function rec(role: RoleId, status: AgentRecord["status"], fn: string, input: Record<string, unknown>, output: Record<string, unknown>, effect: AgentRecord["effect"], error: string | null = null): AgentRecord {
  const now = new Date().toISOString();
  return { role, status, invoked: status === "DETERMINISTIC", startedAt: now, finishedAt: now, durationMs: 0, functionUsed: fn, input, output, effect, error };
}

export function runMissionCycle(input: {
  bars: Bar[];
  nowMs?: number;
  strategyHash?: string;
  strategyApproved?: boolean;
  pilotExpired?: boolean;
  billingLocked?: boolean;
  brokerConnected?: boolean;
  stale?: boolean;
  duplicate?: boolean;
}): MissionTrace {
  const nowMs = input.nowMs ?? Date.now();
  const signal: FmzSignal = evaluateFmz(input.bars, 250, nowMs);
  const hash = input.strategyHash ?? FROZEN_RULES_SHA256;
  const hashMatch = hash === FROZEN_RULES_SHA256;
  const billingLocked = input.billingLocked !== false;
  const strategyApproved = input.strategyApproved === true;
  const pilotExpired = input.pilotExpired !== false;
  const brokerConnected = input.brokerConnected !== false;
  const reasons: string[] = [];
  if (!hashMatch) reasons.push("strategy hash mismatch");
  if (signal.barsUsed < 250) reasons.push(signal.reason);
  if (input.stale) reasons.push("stale market data");
  if (!strategyApproved) reasons.push("strategyApproved=false");
  if (pilotExpired) reasons.push("paper pilot expired");
  if (billingLocked) reasons.push("XAI_BILLING_LOCK active");
  if (!brokerConnected) reasons.push("broker connection missing");
  if (input.duplicate) reasons.push("duplicate execution request");
  const sigma: MissionTrace["sigma"] = !hashMatch || signal.barsUsed < 250 || input.stale ? "REJECT" : "PASS";
  const sentinel: MissionTrace["sentinel"] = reasons.length ? "VETO" : "PASS";
  const eligible = sigma === "PASS" && sentinel === "PASS" && signal.signal === "BUY";
  const finalDecision: MissionTrace["finalDecision"] = eligible ? "BUY" : signal.signal === "EXIT" && sentinel === "PASS" ? "EXIT" : "NO_TRADE";
  const agents: AgentRecord[] = [
    rec("scout", "DETERMINISTIC", "scanUniverse", { symbol: "BTC/USD" }, { candidates: ["BTC/USD"], count: 1 }, "ADVISORY"),
    rec("vector", "DETERMINISTIC", "evaluateFmz", { bars: signal.barsUsed, latest: signal.barTime }, { signal: signal.signal, rsi: signal.rsi, lower: signal.lower, upper: signal.upper, atr14: signal.atr14, reason: signal.reason }, "ADVISORY"),
    rec("atlas", "SKIPPED", "none", { symbol: "BTC/USD" }, { stance: "UNAVAILABLE" }, "NONE", "BTC spot has no equity fundamental feed; existing role marks Atlas out of scope"),
    rec("oracle", "SKIPPED", "none", {}, { stance: "UNAVAILABLE" }, "NONE", "no live macro feed in this cycle"),
    rec("pulse", "SKIPPED", "none", {}, { stance: "UNAVAILABLE" }, "NONE", "no live news feed; paid sentiment blocked by billing lock"),
    rec("volta", "SKIPPED", "none", { symbol: "BTC/USD" }, { stance: "UNAVAILABLE" }, "NONE", "spot cycle has no options or derivatives data"),
    rec("bull", "SKIPPED", "none", { billingLock: billingLocked }, { stance: "UNAVAILABLE" }, "NONE", "XAI_BILLING_LOCK active; historical Bull result not used as live analysis"),
    rec("bear", "SKIPPED", "none", { billingLock: billingLocked }, { stance: "UNAVAILABLE" }, "NONE", "XAI_BILLING_LOCK active; historical Bear result not used as live analysis"),
    rec("sigma", "DETERMINISTIC", "evaluateFmz+hashCheck", { hash, bars: signal.barsUsed }, { result: sigma, signal: signal.signal }, sigma === "REJECT" ? "VETO" : "ADVISORY"),
    rec("sentinel", "DETERMINISTIC", "riskVeto", { strategyApproved, pilotExpired, billingLocked }, { result: sentinel, reasons }, "VETO"),
    rec("allocator", eligible ? "DETERMINISTIC" : "SKIPPED", eligible ? "sizeNotional" : "none", { maxUsd: 25 }, eligible ? { notionalUsd: 10 } : { skipped: true }, "NONE", eligible ? null : "no eligible BUY after Sigma/Sentinel"),
    rec("pilot", "DETERMINISTIC", "planDryRun", { decision: finalDecision }, { mode: eligible ? "DRY_RUN" : "BLOCKED", brokerWrites: 0 }, "NONE"),
    rec("hermes", "DETERMINISTIC", "writeJournal", { decision: finalDecision }, { saved: true }, "JOURNAL"),
  ];
  if (agents.length !== ROLES.length) throw new Error("agent count mismatch");
  return {
    traceId: `mc-${randomUUID()}`,
    evaluatedAt: new Date(nowMs).toISOString(),
    market: { source: "alpaca-crypto-bars", symbol: "BTC/USD", timeframe: "15Min", latestCompletedCandle: signal.barTime, completedBars: signal.barsUsed, missing: signal.barsUsed < 250 ? signal.reason : null },
    strategy: { id: "fmz-bollinger-rsi-long-v1", hash: FROZEN_RULES_SHA256, hashMatch },
    agents,
    sigma,
    sentinel,
    sentinelReasons: reasons,
    allocator: agents.find((a) => a.role === "allocator")!.output,
    finalDecision,
    pilot: eligible ? "DRY_RUN" : "BLOCKED",
    hermes: "SAVED",
    aiModelCalls: 0,
    brokerWrites: 0,
    flags: { LIVE: false, PAPER_AUTO: false, strategyApproved: false, billingLock: true },
  };
}

export function strategyFileHash(source: string): string {
  return createHash("sha256").update(source).digest("hex");
}
