import assert from "node:assert/strict";
import test from "node:test";
import { adaptExecutorJournal, ingestOutcomes, type ExecutionOutcome, type TrustedEvidence } from "./hermes-outcomes.ts";

const fill = (over: Partial<ExecutionOutcome>): ExecutionOutcome => ({
  decisionId: "d1", strategyVersion: "v1", clientOrderId: "c", symbol: "SPY", side: "buy", qty: 0.03,
  fillPrice: 750, intendedPrice: 749.9, fee: 0.03, source: "PAPER", brokerOrderId: "b", fillId: "f", corrected: false, at: "2026-11-16T15:00:00Z", ...over,
});
const trust = (row: ExecutionOutcome): TrustedEvidence => ({ clientOrderId: row.clientOrderId, brokerOrderId: row.brokerOrderId!, fillId: row.fillId!, qty: row.qty, fillPrice: row.fillPrice, source: row.source as "PAPER" });

test("open BUY, partial SELL and confirmed close report -$0.02", () => {
  const buy = fill({ clientOrderId: "buy", fillId: "f1", qty: 0.03, fillPrice: 750, fee: 0.03, at: "2026-11-16T15:00:00Z" });
  const sell1 = fill({ clientOrderId: "sell1", fillId: "f2", side: "sell", qty: 0.01, fillPrice: 752, intendedPrice: 752.1, fee: 0.01, at: "2026-11-16T15:01:00Z" });
  const sell2 = fill({ clientOrderId: "sell2", fillId: "f3", side: "sell", qty: 0.02, fillPrice: 751, intendedPrice: 751, fee: 0.02, at: "2026-11-16T15:02:00Z" });
  const rows = [buy, sell1, sell2];
  const trusted = rows.map(trust);
  const open = ingestOutcomes([buy], [trust(buy)]);
  assert.equal(open.paper[0]!.status, "UNREALIZED");
  const partial = ingestOutcomes([buy, sell1], [buy, sell1].map(trust));
  assert.equal(partial.paper[0]!.status, "UNREALIZED");
  assert.ok(Math.abs(partial.paper[0]!.realizedPnl - 0) < 1e-9);
  const closed = ingestOutcomes(rows, trusted);
  assert.equal(closed.paper[0]!.status, "CLOSED");
  assert.ok(Math.abs(closed.paper[0]!.realizedPnl - (-0.02)) < 1e-9);
});

test("zero P&L flat book is CLOSED; oversized sell fails; correction replaces", () => {
  const buy = fill({ clientOrderId: "buy", fillId: "f1", qty: 1, fillPrice: 100, fee: 0, at: "2026-11-16T15:00:00Z" });
  const sell = fill({ clientOrderId: "sell", fillId: "f2", side: "sell", qty: 1, fillPrice: 100, fee: 0, at: "2026-11-16T15:01:00Z" });
  const flat = ingestOutcomes([buy, sell], [buy, sell].map(trust));
  assert.equal(flat.paper[0]!.status, "CLOSED");
  assert.equal(flat.paper[0]!.realizedPnl, 0);
  const over = fill({ clientOrderId: "over", fillId: "f3", side: "sell", qty: 2, fillPrice: 100, fee: 0, at: "2026-11-16T15:02:00Z" });
  const failed = ingestOutcomes([buy, over], [buy, over].map(trust));
  assert.equal(failed.paper[0]!.failed, true);
  assert.equal(failed.paper[0]!.status, "INCOMPLETE");
  const corrected = fill({ clientOrderId: "buy", fillId: "f1", qty: 1, fillPrice: 101, fee: 0, corrected: true, at: "2026-11-16T15:03:00Z" });
  const replaced = ingestOutcomes([buy, corrected, sell], [buy, corrected, sell].map(trust));
  assert.ok(Math.abs(replaced.paper[0]!.realizedPnl - (100 - 101)) < 1e-9);
});

test("untrusted strings, MOCK and kind-only journal lines are incomplete", () => {
  const buy = fill({});
  const report = ingestOutcomes([buy], []);
  assert.equal(report.paper.length, 0);
  assert.ok(report.notes.some((n) => n.includes("trusted")));
  const mock = ingestOutcomes([fill({ source: "MOCK" })], []);
  assert.equal(mock.mockIgnored, 1);
  assert.equal(adaptExecutorJournal(['{"kind":"ACCEPTED","clientOrderId":"x"}', '{"event":"BROKER","clientOrderId":"y"}']).incomplete, 2);
});
