import { createHash, randomUUID } from "node:crypto";
import { ROLES, type RoleId } from "../research/roles.ts";
import { planPaperOrder } from "../broker/paper-pipeline.ts";
import { quoteFreshness, relevantMacro, relevantNews, type Quote } from "./agent-cycle.ts";
import type { FeedObservation } from "../research/public-feeds.ts";

export interface Decision {
  traceId: string;
  instrument: string;
  session: "24/7" | "US_EQUITY";
  dataQuality: "FRESH" | "STALE" | "UNAVAILABLE";
  strategyId: string | null;
  strategyHash: string | null;
  signal: "BUY" | "EXIT" | "WAIT";
  sigma: "PASS" | "REJECT";
  sentinel: "PASS" | "VETO";
  sentinelReasons: string[];
  allocator: { qty: number; skipped: boolean; reason: string };
  pilot: { action: "NO_TRADE" | "DRY_RUN_BUY" | "DRY_RUN_EXIT"; qty: number; reason: string; brokerWrites: 0 };
  hermesJournalId: string;
  agents: Array<{ role: RoleId; state: string; freshness: string; effect: string; conclusion: string }>;
  decision: "BUY" | "EXIT" | "NO_TRADE";
  brokerWrites: 0;
  aiModelCalls: 0;
}

export function candleCloseMs(openIso: string, timeframeMs = 15 * 60 * 1000): number {
  return Date.parse(openIso) + timeframeMs;
}

export function hashSpec(spec: unknown): string {
  return createHash("sha256").update(JSON.stringify(spec)).digest("hex");
}

export function decide(input: {
  nowMs?: number;
  instrument?: string;
  quotes: Quote[];
  oracle?: FeedObservation[];
  pulse?: FeedObservation[];
  volta?: FeedObservation[];
  strategy?: { id: string; spec: unknown; signal: "BUY" | "EXIT" | "WAIT"; approved: boolean } | null;
  authorizationExpiresAt?: string | null;
  ownedQty?: number;
  cash?: number;
  price?: number;
  fixtureApproval?: boolean;
}): Decision {
  const nowMs = input.nowMs ?? Date.now();
  const instrument = input.instrument ?? "BTC/USD";
  const quote = input.quotes.find((q) => q.symbol === instrument);
  const future = quote?.observedAt ? Date.parse(quote.observedAt) - nowMs > 5 * 60 * 1000 : false;
  const freshness = !quote || future ? "UNAVAILABLE" : quoteFreshness(quote, nowMs);
  const strategy = input.strategy ?? null;
  const approved = input.fixtureApproval === true && strategy?.approved === true;
  const signal = freshness === "FRESH" && strategy ? strategy.signal : "WAIT";
  const macro = relevantMacro(input.oracle ?? []);
  const news = relevantNews(input.pulse ?? [], instrument);
  const reasons: string[] = [];
  if (freshness !== "FRESH") reasons.push(`data ${freshness.toLowerCase()}`);
  if (!strategy) reasons.push("no approved strategy");
  if (!approved) reasons.push("strategyApproved=false");
  if (!input.authorizationExpiresAt || Date.parse(input.authorizationExpiresAt) <= nowMs) reasons.push("authorization expired");
  const sigma = freshness === "FRESH" && strategy ? "PASS" : "REJECT";
  const sentinel = reasons.length ? "VETO" : "PASS";
  const riskOk = sentinel === "PASS";
  const plan = planPaperOrder({
    signal: signal === "BUY" && riskOk ? "BUY" : signal === "EXIT" ? "EXIT" : "WAIT",
    price: input.price ?? quote?.price ?? 0,
    cash: input.cash ?? 0,
    maxNotional: 25,
    strategyApproved: approved,
    riskOk,
    billingLocked: true,
    authorizationExpiresAt: input.authorizationExpiresAt ?? null,
    nowMs,
    ownedQty: input.ownedQty ?? 0,
    endpoint: "https://paper-api.alpaca.markets/v2/orders",
  });
  const decision = plan.action === "DRY_RUN_BUY" ? "BUY" : plan.action === "DRY_RUN_EXIT" ? "EXIT" : "NO_TRADE";
  const traceId = `dec-${randomUUID()}`;
  const agents = ROLES.map((role) => {
    if (role === "bull" || role === "bear") return { role, state: "BLOCKED", freshness: "UNAVAILABLE", effect: "NONE", conclusion: "paid call blocked; does not block risk-reducing exit" };
    if (role === "atlas") return { role, state: "NOT_APPLICABLE", freshness: "NOT_APPLICABLE", effect: "NONE", conclusion: "no operating-company fundamentals for this instrument" };
    if (role === "sigma") return { role, state: "DETERMINISTIC", freshness, effect: sigma === "REJECT" ? "VETO" : "ADVISORY", conclusion: sigma };
    if (role === "sentinel") return { role, state: "DETERMINISTIC", freshness: "FRESH", effect: "VETO", conclusion: reasons.join("; ") || "PASS" };
    if (role === "pilot") return { role, state: "DETERMINISTIC", freshness: "FRESH", effect: "PLAN", conclusion: plan.action };
    if (role === "hermes") return { role, state: "DETERMINISTIC", freshness: "FRESH", effect: "JOURNAL", conclusion: traceId };
    if (role === "oracle") return { role, state: macro.length ? "DETERMINISTIC" : "UNAVAILABLE", freshness: macro.length ? "FRESH" : "UNAVAILABLE", effect: "ADVISORY", conclusion: `${macro.length} relevant macro items` };
    if (role === "pulse") return { role, state: "DETERMINISTIC", freshness: (input.pulse ?? []).length ? "FRESH" : "UNAVAILABLE", effect: "ADVISORY", conclusion: `${news.verified.length} verified, ${news.background.length} background` };
    if (role === "volta") return { role, state: (input.volta ?? []).length ? "DETERMINISTIC" : "UNAVAILABLE", freshness: (input.volta ?? []).length ? "FRESH" : "UNAVAILABLE", effect: "ADVISORY", conclusion: "equity VIX context only" };
    if (role === "vector") return { role, state: "DETERMINISTIC", freshness, effect: "ADVISORY", conclusion: signal };
    return { role, state: freshness === "FRESH" ? "DETERMINISTIC" : "STALE", freshness, effect: "ADVISORY", conclusion: instrument };
  });
  return {
    traceId,
    instrument,
    session: quote?.session ?? "24/7",
    dataQuality: freshness,
    strategyId: strategy?.id ?? null,
    strategyHash: strategy ? hashSpec(strategy.spec) : null,
    signal,
    sigma,
    sentinel,
    sentinelReasons: reasons,
    allocator: { qty: plan.qty, skipped: plan.action !== "DRY_RUN_BUY", reason: plan.reason },
    pilot: plan,
    hermesJournalId: traceId,
    agents,
    decision,
    brokerWrites: 0,
    aiModelCalls: 0,
  };
}
