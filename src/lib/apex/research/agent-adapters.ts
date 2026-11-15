import type { RoleId } from "./roles.ts";
import { evaluateFmz, type Bar } from "./fmz-bb-rsi.ts";
import { paidRequestsBlocked } from "./billing-lock.ts";

export type AgentState = "DETERMINISTIC" | "NOT_APPLICABLE" | "UNAVAILABLE" | "BLOCKED" | "FAILED";

export interface AgentOutput {
  role: RoleId;
  state: AgentState;
  asOf: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  effect: "NONE" | "ADVISORY" | "VETO" | "SIZE" | "PLAN" | "JOURNAL";
  modelCall: false;
  error: string | null;
}

export function runAgents(input: {
  symbol: string;
  bars: Bar[];
  nowMs: number;
  billingLockPath?: string;
  hasMacro: boolean;
  hasNews: boolean;
  hasDerivatives: boolean;
  hasFundamentals: boolean;
}): AgentOutput[] {
  const now = new Date(input.nowMs).toISOString();
  const signal = evaluateFmz(input.bars, 250, input.nowMs);
  const locked = input.billingLockPath ? paidRequestsBlocked(input.billingLockPath) : true;
  const crypto = input.symbol.includes("BTC") || input.symbol.includes("ETH");
  const out: AgentOutput[] = [];
  out.push({ role: "scout", state: "DETERMINISTIC", asOf: now, input: { symbol: input.symbol }, output: { scanned: [input.symbol], candidates: signal.barsUsed >= 250 ? [input.symbol] : [] }, effect: "ADVISORY", modelCall: false, error: null });
  out.push({ role: "vector", state: "DETERMINISTIC", asOf: now, input: { bars: signal.barsUsed, latest: signal.barTime }, output: { signal: signal.signal, rsi: signal.rsi, lower: signal.lower, upper: signal.upper, atr14: signal.atr14, reason: signal.reason }, effect: "ADVISORY", modelCall: false, error: null });
  out.push({ role: "atlas", state: crypto || !input.hasFundamentals ? "NOT_APPLICABLE" : "DETERMINISTIC", asOf: now, input: { symbol: input.symbol }, output: { stance: "UNAVAILABLE" }, effect: "NONE", modelCall: false, error: crypto ? "spot crypto has no equity fundamental statement" : "fundamental source not connected" });
  out.push({ role: "oracle", state: input.hasMacro ? "DETERMINISTIC" : "UNAVAILABLE", asOf: now, input: {}, output: { stance: input.hasMacro ? "OBSERVED" : "UNAVAILABLE" }, effect: "NONE", modelCall: false, error: input.hasMacro ? null : "no macro feed configured" });
  out.push({ role: "pulse", state: input.hasNews && !locked ? "DETERMINISTIC" : "UNAVAILABLE", asOf: now, input: { billingLocked: locked }, output: { stance: "UNAVAILABLE" }, effect: "NONE", modelCall: false, error: locked ? "billing lock blocks paid sentiment" : "no news feed" });
  out.push({ role: "volta", state: input.hasDerivatives ? "DETERMINISTIC" : "UNAVAILABLE", asOf: now, input: { symbol: input.symbol }, output: { stance: "UNAVAILABLE" }, effect: "NONE", modelCall: false, error: input.hasDerivatives ? null : "no derivatives feed" });
  out.push({ role: "bull", state: locked ? "BLOCKED" : "UNAVAILABLE", asOf: now, input: { billingLocked: locked }, output: { stance: "UNAVAILABLE" }, effect: "NONE", modelCall: false, error: "paid Bull call blocked" });
  out.push({ role: "bear", state: locked ? "BLOCKED" : "UNAVAILABLE", asOf: now, input: { billingLocked: locked }, output: { stance: "UNAVAILABLE" }, effect: "NONE", modelCall: false, error: "paid Bear call blocked" });
  return out;
}
