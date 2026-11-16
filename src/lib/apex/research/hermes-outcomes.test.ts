import assert from "node:assert/strict";
import test from "node:test";
import { adaptExecutorJournal, ingestOutcomes, type ExecutionOutcome } from "./hermes-outcomes.ts";

const fill = (over: Partial<ExecutionOutcome>): ExecutionOutcome => ({
  decisionId: "d1", strategyVersion: "v1", clientOrderId: "c", symbol: "SPY", side: "buy", qty: 0.03,
  fillPrice: 750, intendedPrice: 749.9, fee: 0.03, source: "PAPER", brokerOrderId: "b", fillId: "f", corrected: false, ...over,
});

test("open BUY, partial SELL and later close have correct FIFO P&L", () => {
  const open = ingestOutcomes([fill({ clientOrderId: "buy", fillId: "f1", qty: 0.03, fillPrice: 750, fee: 0.03 })]);
  assert.equal(open.paper[0]!.status, "UNREALIZED");
  assert.equal(open.paper[0]!.openQty, 0.03);
  assert.equal(open.paper[0]!.realizedPnl, 0);

  const partial = ingestOutcomes([
    fill({ clientOrderId: "buy", fillId: "f1", qty: 0.03, fillPrice: 750, fee: 0.03 }),
    fill({ clientOrderId: "sell1", fillId: "f2", side: "sell", qty: 0.01, fillPrice: 752, intendedPrice: 752.1, fee: 0.01 }),
  ]);
  assert.equal(partial.paper[0]!.status, "UNREALIZED");
  assert.ok(Math.abs(partial.paper[0]!.openQty - 0.02) < 1e-9);
  assert.ok(Math.abs(partial.paper[0]!.realizedPnl - 0) < 1e-9);

  const closed = ingestOutcomes([
    fill({ clientOrderId: "buy", fillId: "f1", qty: 0.03, fillPrice: 750, fee: 0.03 }),
    fill({ clientOrderId: "sell1", fillId: "f2", side: "sell", qty: 0.01, fillPrice: 752, intendedPrice: 752.1, fee: 0.01 }),
    fill({ clientOrderId: "sell2", fillId: "f3", side: "sell", qty: 0.02, fillPrice: 751, intendedPrice: 751, fee: 0.02 }),
  ]);
  assert.equal(closed.paper[0]!.status, "CLOSED");
  assert.equal(closed.paper[0]!.openQty, 0);
  const expected = (752 - 750) * 0.01 - 0.01 - 0.01 + (751 - 750) * 0.02 - 0.02 - 0.02;
  assert.ok(Math.abs(closed.paper[0]!.realizedPnl - expected) < 1e-9);
});

test("MOCK, missing evidence and LIVE stay out of PAPER performance", () => {
  const report = ingestOutcomes([
    fill({ source: "MOCK", brokerOrderId: null, fillId: null }),
    fill({ clientOrderId: "bare", fillId: null, brokerOrderId: null }),
    fill({ source: "LIVE", clientOrderId: "live", fillId: "lf", brokerOrderId: "lb" }),
  ]);
  assert.equal(report.mockIgnored, 1);
  assert.equal(report.paper.length, 0);
  assert.equal(report.live[0]!.source, "LIVE");
  assert.equal(adaptExecutorJournal(['{"event":"ACCEPTED","clientOrderId":"x"}']).incomplete, 1);
});
