import assert from "node:assert/strict";
import test from "node:test";
import { buildProposal } from "./proposal.ts";
import { scanUniverse } from "./scanner.ts";
import { runCanonicalDecision, type Bar } from "./canonical-decision.ts";

const bars = (n: number, start = 100): Bar[] => Array.from({ length: n }, (_, i) => ({ date: `2026-${String(Math.floor(i / 28) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`, open: start + i, high: start + i + 1, low: start + i - 1, close: start + i }));

test("scanner ranks candidates and proposal is unsigned", () => {
  const spy = bars(220, 400);
  const qqq = bars(220, 300);
  const ranked = scanUniverse({ SPY: spy, QQQ: qqq }, spy);
  assert.equal(ranked.length, 2);
  const trace = runCanonicalDecision({
    strategyVersion: "etf-xs-breakout-20-v1",
    symbol: "QQQ",
    bars: qqq,
    spyBars: spy,
    universe: { SPY: spy, QQQ: qqq },
    asOf: `${qqq.at(-1)!.date}T21:00:00Z`,
    provenance: "test",
    dataOk: true,
    proposedNotional: 25,
    broker: { ownedQty: 0, openExitQty: 0, asOf: `${qqq.at(-1)!.date}T21:00:00Z` },
  });
  const proposal = buildProposal(trace);
  assert.equal(proposal.source, "RESEARCH_PROPOSAL");
  assert.equal(proposal.strategyApproved, false);
  assert.equal(proposal.executionAuthorized, false);
  assert.equal(proposal.operatorProof, null);
  assert.equal(proposal.limitPrice, null);
  assert.equal(proposal.v, 1);
});
