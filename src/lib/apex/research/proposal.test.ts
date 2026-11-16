import assert from "node:assert/strict";
import test from "node:test";
import { buildProposal } from "./proposal.ts";
import { ingestOutcomes } from "./hermes-outcomes.ts";
import { runCanonicalDecision, type Bar } from "./canonical-decision.ts";

const bars = (n: number, start = 100): Bar[] => Array.from({ length: n }, (_, i) => {
  const d = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
  return { date: d, open: start + i, high: start + i + 1, low: start + i - 1, close: start + i };
});

test("NO_TRADE has no executable order and quantity is never assumed", () => {
  const spy = bars(220, 400);
  const trace = runCanonicalDecision({
    strategyVersion: "etf-xs-breakout-20-v1", symbol: "SPY", bars: spy, spyBars: spy,
    asOf: `${spy.at(-1)!.date}T21:00:00Z`, provenance: "test", dataOk: true, proposedNotional: 25,
    broker: { ownedQty: 0, openExitQty: 0, asOf: `${spy.at(-1)!.date}T21:00:00Z` },
  });
  const proposal = buildProposal(trace, 25);
  assert.equal(proposal.executable, false);
  assert.equal(proposal.qty, null);
  assert.equal(proposal.limitPrice, null);
  assert.notEqual(proposal.dataAsOf, proposal.validUntil);
  if (trace.researchRecommendation === "NO_TRADE") {
    assert.equal(proposal.side, null);
    assert.equal(proposal.validUntil, null);
  }
});

test("mock Executor feedback is ingested and is not real performance", () => {
  const report = ingestOutcomes([
    { decisionId: "d1", strategyVersion: "etf-xs-breakout-20-v1", clientOrderId: "c1", symbol: "SPY", side: "buy", qty: 0.03, fillPrice: 750, intendedPrice: 749.5, fee: 0.1, source: "MOCK", brokerConfirmed: false, corrected: false },
    { decisionId: "d1", strategyVersion: "etf-xs-breakout-20-v1", clientOrderId: "c1", symbol: "SPY", side: "buy", qty: 0.03, fillPrice: 750, intendedPrice: 749.5, fee: 0.1, source: "MOCK", brokerConfirmed: false, corrected: false },
    { decisionId: "", strategyVersion: "etf-xs-breakout-20-v1", clientOrderId: "c2", symbol: "SPY", side: "sell", qty: 0.03, fillPrice: 751, intendedPrice: 751, fee: 0.1, source: "PAPER", brokerConfirmed: true, corrected: false },
  ]);
  assert.equal(report.realPerformance, false);
  assert.equal(report.realizedPnl, null);
  assert.equal(report.duplicates.length, 1);
  assert.equal(report.missing.length, 1);
});

test("broker-confirmed PAPER pair reports P&L separately from mock", () => {
  const report = ingestOutcomes([
    { decisionId: "d1", strategyVersion: "v1", clientOrderId: "buy", symbol: "SPY", side: "buy", qty: 1, fillPrice: 100, intendedPrice: 99.9, fee: 0.1, source: "PAPER", brokerConfirmed: true, corrected: false },
    { decisionId: "d1", strategyVersion: "v1", clientOrderId: "sell", symbol: "SPY", side: "sell", qty: 1, fillPrice: 101, intendedPrice: 101.1, fee: 0.1, source: "PAPER", brokerConfirmed: true, corrected: false },
  ]);
  assert.equal(report.realPerformance, true);
  assert.equal(report.matched, 2);
  assert.ok((report.realizedPnl ?? 0) > 0);
  assert.equal(report.costs, 0.2);
});
