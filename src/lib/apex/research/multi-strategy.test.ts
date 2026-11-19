import assert from "node:assert/strict";
import test from "node:test";
import { evaluate, LOGICAL_ROLES, STRATEGY_REGISTRY, type MarketSnapshot } from "./multi-strategy.ts";
import { architectureReadiness } from "../live/architecture.ts";

const snap = (over: Partial<MarketSnapshot> = {}): MarketSnapshot => ({
  symbol: "SPY", asOf: "2026-11-19T18:00:00Z", close: 500, sma200: 450, vol20: 0.01,
  dataAgeMs: 1000, macroPresent: true, positioningPresent: true, ownedQty: 0, correlatedExposure: 0, ...over,
});

test("multiple signals still cannot approve a rejected strategy", () => {
  const d = evaluate(snap(), { "etf-xs-breakout-20-v1": "BUY", "etf-weekly-momentum-v1": "BUY", "synthetic-eligible-fixture": "BUY" });
  assert.equal(d.recommendation, "NO_TRADE");
  assert.equal(d.pilot.strategyApproved, false);
  assert.equal(d.pilot.executable, false);
  assert.equal(d.ranking.scoreIsProbability, false);
  assert.ok(d.rejected.some((r) => r.reason.includes("NO_WINNER")));
});

test("no eligible strategy, missing data, conflict, stale and veto cases fail closed", () => {
  assert.equal(evaluate(snap(), {}).recommendation, "NO_TRADE");
  assert.ok(evaluate(snap({ macroPresent: false }), { "synthetic-eligible-fixture": "BUY" }).warden.includes("missing macro"));
  const conflict = evaluate(snap(), { "synthetic-eligible-fixture": "BUY" }, { billingLocked: false, bull: "BUY", bear: "NO" });
  assert.ok(conflict.warden.includes("Bull/Bear conflict"));
  assert.equal(conflict.recommendation, "NO_TRADE");
  assert.equal(evaluate(snap({ dataAgeMs: 60 * 60 * 1000 }), { "synthetic-eligible-fixture": "BUY" }).recommendation, "NO_TRADE");
  assert.equal(evaluate(snap({ correlatedExposure: 1 }), { "synthetic-eligible-fixture": "BUY" }).reason, "correlated exposure");
  assert.equal(evaluate(snap(), { "synthetic-eligible-fixture": "BUY" }, { timeoutRoles: ["Oracle"] }).recommendation, "NO_TRADE");
});

test("protective exit does not wait for LLM consensus", () => {
  const d = evaluate(snap({ ownedQty: 1 }), { "synthetic-eligible-fixture": "EXIT" }, { billingLocked: true });
  assert.equal(d.recommendation, "EXIT");
  assert.equal(d.reason.includes("does not wait"), true);
  assert.equal(d.hermes.realPerformance, false);
});

test("roles and stages remain intact", () => {
  assert.equal(LOGICAL_ROLES.length, 15);
  assert.equal(STRATEGY_REGISTRY["etf-xs-breakout-20-v1"]!.approved, false);
  assert.equal(architectureReadiness().length, 6);
});
