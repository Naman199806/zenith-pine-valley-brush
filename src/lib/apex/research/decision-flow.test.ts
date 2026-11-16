import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { ROLES, runCanonicalDecision, type Bar } from "./canonical-decision.ts";
import { architectureReadiness } from "../live/architecture.ts";
import { PAPER_POST_ENABLED } from "../broker/paper-equity-transport.ts";

function bars(path: string): Bar[] {
  const doc = JSON.parse(readFileSync(path, "utf8"));
  return doc.bars.slice(-260).map((b: Bar) => ({ date: b.date, open: b.open, high: b.high, low: b.low, close: b.close }));
}

test("real bars produce a full 13-role decision and Sigma blocks the rejected strategy", () => {
  const spy = bars("research/data/raw/yahoo/20261112/SPY.json");
  const qqq = bars("research/data/raw/yahoo/20261112/QQQ.json");
  const asOf = `${spy.at(-1)!.date}T20:00:00Z`;
  const t = runCanonicalDecision({
    strategyVersion: "etf-xs-breakout-20-v1",
    symbol: "QQQ",
    bars: qqq,
    spyBars: spy,
    universe: { SPY: spy, QQQ: qqq },
    asOf,
    provenance: "yahoo-chart-v8/20261112",
    dataOk: true,
    proposedNotional: 25,
    broker: { ownedQty: 0, openExitQty: 0, asOf },
  });
  assert.deepEqual(t.roles.map((r) => r.role), [...ROLES]);
  assert.equal(t.executionAuthorized, false);
  assert.equal(t.brokerExecutable, false);
  assert.equal(t.roles.find((r) => r.role === "Bull")!.invoked, false);
  assert.equal(t.roles.find((r) => r.role === "Vector")!.invoked, true);
  assert.ok(["BUY", "EXIT", "NO_TRADE"].includes(t.researchRecommendation));
  if (t.roles.find((r) => r.role === "Vector")!.output.signal === "BUY") {
    assert.equal(t.researchRecommendation, "NO_TRADE");
    assert.ok(t.reason.includes("NO_WINNER"));
  }
});

test("EXIT of an owned position is a decision, not a broker authorization", () => {
  const spy = bars("research/data/raw/yahoo/20261112/SPY.json");
  const crashed = spy.map((b, i) => i === spy.length - 1 ? { ...b, close: 1, high: 2, low: 0.5 } : b);
  const t = runCanonicalDecision({
    strategyVersion: "etf-xs-breakout-20-v1",
    symbol: "SPY",
    bars: crashed,
    spyBars: spy,
    asOf: `${spy.at(-1)!.date}T20:00:00Z`,
    provenance: "fixture-exit",
    dataOk: true,
    proposedNotional: 100,
    broker: { ownedQty: 0.5, openExitQty: 0, asOf: `${spy.at(-1)!.date}T20:00:00Z` },
  });
  assert.equal(t.researchRecommendation, "EXIT");
  assert.equal(t.executionAuthorized, false);
});

test("six stages are present and PAPER POST stays disabled", () => {
  assert.equal(architectureReadiness().length, 6);
  assert.equal(PAPER_POST_ENABLED, false);
});
