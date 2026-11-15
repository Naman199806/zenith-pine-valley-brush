import assert from "node:assert/strict";
import test from "node:test";
import { assertNotRejected, quoteFreshness, relevantNews, runIntegratedCycle } from "./agent-cycle.ts";

const now = Date.parse("2026-11-15T06:40:00Z");
const quotes = [
  { symbol: "BTC/USD", price: 65000, observedAt: "2026-11-15T06:35:00Z", source: "alpaca", session: "24/7" as const },
  { symbol: "SPY", price: 500, observedAt: "2026-11-14T21:00:00Z", source: "yahoo", session: "US_EQUITY" as const },
];

test("crypto freshness fails when the observation is old", () => {
  assert.equal(quoteFreshness({ symbol: "BTC/USD", price: 1, observedAt: "2026-11-15T05:00:00Z", source: "alpaca", session: "24/7" }, now), "STALE");
});

test("integrated cycle covers all 13 roles and writes no orders", () => {
  const cycle = runIntegratedCycle({ nowMs: now, quotes, oracle: [{ source: "fed", title: "FOMC rate decision", published: "2026-11-15T06:00:00Z", url: "https://example.test" }], pulse: [{ source: "sec", title: "unrelated filing", published: "2026-11-15T06:00:00Z", url: null }], volta: [{ source: "yahoo-vix", title: "VIX 18", published: "2026-11-15T06:00:00Z", url: null }], frozen: { candidates: [] } });
  assert.equal(cycle.agents.length, 13);
  assert.equal(cycle.decision, "NO_TRADE");
  assert.equal(cycle.brokerWrites, 0);
  assert.equal(cycle.aiModelCalls, 0);
  assert.equal(cycle.agents.find((a) => a.role === "sentinel")?.effect, "VETO");
  assert.equal(cycle.agents.find((a) => a.role === "hermes")?.effect, "JOURNAL");
  assert.equal(cycle.agents.find((a) => a.role === "bull")?.state, "BLOCKED");
});

test("rejected strategies cannot be reopened", () => {
  assert.throws(() => assertNotRejected("fmz-bollinger-rsi-long-v1"), /cannot be reopened/);
});

test("news relevance separates verified events from background", () => {
  const news = relevantNews([{ source: "sec", title: "BTC ETF filing", published: null, url: null }, { source: "sec", title: "bank rule", published: null, url: null }], "BTC/USD");
  assert.equal(news.verified.length, 1);
  assert.equal(news.background.length, 1);
});
