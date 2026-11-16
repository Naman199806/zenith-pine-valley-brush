import assert from "node:assert/strict";
import test from "node:test";
import { buildProposal } from "./proposal.ts";
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

test("mock Executor feedback is not a research order", () => {
  const spy = bars(220, 400);
  const trace = runCanonicalDecision({
    strategyVersion: "etf-xs-breakout-20-v1", symbol: "SPY", bars: spy, spyBars: spy,
    asOf: `${spy.at(-1)!.date}T21:00:00Z`, provenance: "test", dataOk: true, proposedNotional: 25,
    broker: { ownedQty: 0, openExitQty: 0, asOf: `${spy.at(-1)!.date}T21:00:00Z` },
  });
  const proposal = buildProposal(trace);
  assert.equal(proposal.executable, false);
  assert.equal(proposal.operatorProof, null);
});
