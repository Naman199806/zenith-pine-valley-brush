import assert from "node:assert/strict";
import test from "node:test";
import { backtestFmz, missingCandles } from "./fmz-backtest.ts";
import { planPaperOrder } from "../broker/paper-pipeline.ts";
import type { Bar } from "./fmz-bb-rsi.ts";

function bars(n: number): Bar[] {
  return Array.from({ length: n }, (_, i) => ({ t: new Date(Date.parse("2026-01-01T00:00:00Z") + i * 900000).toISOString(), o: 100, h: 101, l: 99, c: 100 }));
}

test("missing candle gaps are counted", () => {
  const sample = bars(3);
  sample[2].t = new Date(Date.parse(sample[0].t) + 4 * 900000).toISOString();
  assert.equal(missingCandles(sample) > 0, true);
});

test("short FMZ history remains insufficient", () => {
  const result = backtestFmz(bars(400), { notionalUsd: 25 });
  assert.equal(result.decision, "INSUFFICIENT_EVIDENCE");
  assert.equal(result.trades < 30 || result.reason.includes("history") || result.reason.includes("bars") || result.reason.includes("trades"), true);
});

test("expired authorization blocks entry but exit can be planned", () => {
  const blocked = planPaperOrder({ signal: "BUY", price: 60000, cash: 1000, maxNotional: 25, strategyApproved: false, riskOk: true, billingLocked: true, authorizationExpiresAt: "2026-11-15T03:05:00Z", nowMs: Date.parse("2026-11-15T12:00:00Z"), ownedQty: 0, endpoint: "https://paper-api.alpaca.markets/v2/orders" });
  assert.equal(blocked.action, "NO_TRADE");
  const exit = planPaperOrder({ signal: "EXIT", price: 60000, cash: 1000, maxNotional: 25, strategyApproved: false, riskOk: true, billingLocked: true, authorizationExpiresAt: "2026-11-15T03:05:00Z", nowMs: Date.parse("2026-11-15T12:00:00Z"), ownedQty: 0.001, endpoint: "https://paper-api.alpaca.markets/v2/orders" });
  assert.equal(exit.action, "DRY_RUN_EXIT");
  assert.equal(exit.brokerWrites, 0);
});

test("live endpoint cannot be planned", () => {
  assert.throws(() => planPaperOrder({ signal: "BUY", price: 1, cash: 1, maxNotional: 1, strategyApproved: true, riskOk: true, billingLocked: false, authorizationExpiresAt: "2099-01-01T00:00:00Z", nowMs: Date.now(), ownedQty: 0, endpoint: "https://api.alpaca.markets/v2/orders" }));
});
