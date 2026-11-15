import { randomUUID } from "node:crypto";
import { ROLES, type RoleId } from "../research/roles.ts";
import { planPaperOrder } from "../broker/paper-pipeline.ts";
import { selectFromFrozen } from "../research/phase2.ts";
import type { FeedObservation } from "../research/public-feeds.ts";

export interface Quote {
  symbol: string;
  price: number | null;
  observedAt: string | null;
  source: string;
  session: "24/7" | "US_EQUITY";
}

export interface CycleAgent {
  role: RoleId;
  state: "DETERMINISTIC" | "NOT_APPLICABLE" | "UNAVAILABLE" | "STALE" | "BLOCKED";
  freshness: "FRESH" | "STALE" | "UNAVAILABLE" | "NOT_APPLICABLE";
  evidence: Record<string, unknown>;
  effect: "ADVISORY" | "VETO" | "SIZE" | "PLAN" | "JOURNAL" | "NONE";
  modelCall: false;
  error: string | null;
}

const REJECTED = new Set(["fmz-bollinger-rsi-long-v1", "btc-donchian-breakout-v1", "btc-mean-revert-regime-v1", "etf-defensive-rs-v1", "btc-ema20-100-v1"]);

export function quoteFreshness(quote: Quote, nowMs: number): "FRESH" | "STALE" | "UNAVAILABLE" {
  if (quote.price == null || !quote.observedAt) return "UNAVAILABLE";
  const age = nowMs - Date.parse(quote.observedAt);
  const max = quote.session === "24/7" ? 20 * 60 * 1000 : 24 * 60 * 60 * 1000;
  return age <= max ? "FRESH" : "STALE";
}

export function relevantMacro(items: FeedObservation[]): FeedObservation[] {
  return items.filter((item) => /rate|inflation|employment|fomc|monetary|payment services/i.test(item.title));
}

export function relevantNews(items: FeedObservation[], symbol: string): { verified: FeedObservation[]; background: FeedObservation[] } {
  const key = symbol.split("/")[0];
  const verified = items.filter((item) => new RegExp(key, "i").test(item.title));
  return { verified, background: items.filter((item) => !verified.includes(item)) };
}

export function assertNotRejected(id: string): void {
  if (REJECTED.has(id)) throw new Error(`rejected candidate cannot be reopened: ${id}`);
}

export function runIntegratedCycle(input: {
  nowMs?: number;
  quotes: Quote[];
  oracle: FeedObservation[];
  pulse: FeedObservation[];
  volta: FeedObservation[];
  frozen: { candidates: Array<{ validation: { id: string; decision: string; netReturn: number; benchmark: number; trades: number } }> };
  symbol?: string;
}): { traceId: string; agents: CycleAgent[]; decision: "NO_TRADE"; selected: string; brokerWrites: 0; aiModelCalls: 0 } {
  const nowMs = input.nowMs ?? Date.now();
  const traceId = `rt-${randomUUID()}`;
  const symbol = input.symbol ?? "BTC/USD";
  const btc = input.quotes.find((q) => q.symbol === symbol);
  const btcFresh = btc ? quoteFreshness(btc, nowMs) : "UNAVAILABLE";
  const macro = relevantMacro(input.oracle);
  const news = relevantNews(input.pulse, symbol);
  const selection = selectFromFrozen(input.frozen);
  const agents: CycleAgent[] = [];
  agents.push({ role: "scout", state: btcFresh === "FRESH" ? "DETERMINISTIC" : "STALE", freshness: btcFresh, evidence: { quotes: input.quotes.map((q) => ({ ...q, freshness: quoteFreshness(q, nowMs) })) }, effect: "ADVISORY", modelCall: false, error: btcFresh === "FRESH" ? null : "stale or missing crypto observation" });
  agents.push({ role: "vector", state: "DETERMINISTIC", freshness: btcFresh, evidence: { approvedResearch: [], rejectedNotUsed: ["fmz-bollinger-rsi-long-v1"], conclusion: "no approved research specification" }, effect: "ADVISORY", modelCall: false, error: null });
  agents.push({ role: "atlas", state: "NOT_APPLICABLE", freshness: "NOT_APPLICABLE", evidence: { symbol, reason: "spot crypto and ETFs have no operating-company fundamental statement" }, effect: "NONE", modelCall: false, error: null });
  agents.push({ role: "oracle", state: macro.length ? "DETERMINISTIC" : "UNAVAILABLE", freshness: macro[0]?.published ? "FRESH" : "UNAVAILABLE", evidence: { relevant: macro.slice(0, 3), ignoredBackground: input.oracle.length - macro.length }, effect: "ADVISORY", modelCall: false, error: macro.length ? null : "no economically relevant macro item" });
  agents.push({ role: "pulse", state: "DETERMINISTIC", freshness: input.pulse[0]?.published ? "FRESH" : "UNAVAILABLE", evidence: { verifiedEvents: news.verified.length, backgroundArticles: news.background.length }, effect: "ADVISORY", modelCall: false, error: news.verified.length ? null : "no instrument-specific verified event" });
  agents.push({ role: "volta", state: input.volta.length ? "DETERMINISTIC" : "UNAVAILABLE", freshness: input.volta[0]?.published ? "FRESH" : "UNAVAILABLE", evidence: { context: "equity-market VIX", btcDerivatives: "UNAVAILABLE", latest: input.volta[0] ?? null }, effect: "ADVISORY", modelCall: false, error: null });
  agents.push({ role: "bull", state: "BLOCKED", freshness: "UNAVAILABLE", evidence: { billingLock: true }, effect: "NONE", modelCall: false, error: "paid Bull call blocked" });
  agents.push({ role: "bear", state: "BLOCKED", freshness: "UNAVAILABLE", evidence: { billingLock: true }, effect: "NONE", modelCall: false, error: "paid Bear call blocked" });
  agents.push({ role: "sigma", state: "DETERMINISTIC", freshness: "FRESH", evidence: { selected: selection.selected, traceId }, effect: "VETO", modelCall: false, error: null });
  agents.push({ role: "sentinel", state: "DETERMINISTIC", freshness: "FRESH", evidence: { reasons: ["strategyApproved=false", selection.reason, btcFresh !== "FRESH" ? "stale market evidence" : "no approved strategy"] }, effect: "VETO", modelCall: false, error: null });
  agents.push({ role: "allocator", state: "DETERMINISTIC", freshness: "FRESH", evidence: { skipped: true }, effect: "SIZE", modelCall: false, error: "no eligible candidate" });
  const plan = planPaperOrder({ signal: "WAIT", price: btc?.price ?? 0, cash: 0, maxNotional: 25, strategyApproved: false, riskOk: false, billingLocked: true, authorizationExpiresAt: null, nowMs, ownedQty: 0, endpoint: "https://paper-api.alpaca.markets/v2/orders" });
  agents.push({ role: "pilot", state: "DETERMINISTIC", freshness: "FRESH", evidence: { ...plan, traceId }, effect: "PLAN", modelCall: false, error: null });
  agents.push({ role: "hermes", state: "DETERMINISTIC", freshness: "FRESH", evidence: { traceId, decision: "NO_TRADE", journal: true }, effect: "JOURNAL", modelCall: false, error: null });
  if (agents.length !== ROLES.length) throw new Error("agent count mismatch");
  return { traceId, agents, decision: "NO_TRADE", selected: selection.selected, brokerWrites: 0, aiModelCalls: 0 };
}
