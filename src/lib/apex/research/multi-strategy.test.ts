import assert from "node:assert/strict";
import test from "node:test";
import { evaluate, STRATEGY_REGISTRY, LOGICAL_ROLES, type MarketSnapshot } from "./multi-strategy.ts";
import { STRATEGY_REGISTRY as CANONICAL } from "./canonical-decision.ts";
import { architectureReadiness } from "../live/architecture.ts";

const snap = (over: Partial<MarketSnapshot> = {}): MarketSnapshot => ({
  symbol: "SPY", asOf: "2026-11-19T18:00:00Z", close: 500, sma200: 450, vol20: 0.01,
  dataAgeMs: 1000, present: { bars: true, spy: true, macro: true, positioning: true },
  ownedQty: 0, ownedSymbol: null, ownedStrategyVersion: null, correlatedExposure: 0, ...over,
});

test("registry is immutable and rejected strategies stay rejected", () => {
  assert.throws(() => { (STRATEGY_REGISTRY["etf-xs-breakout-20-v1"] as { approved: boolean }).approved = true; });
  assert.equal(STRATEGY_REGISTRY["etf-xs-breakout-20-v1"]!.approved, false);
  assert.equal(CANONICAL["etf-xs-breakout-20-v1"]!.approved, false);
  assert.equal(CANONICAL["etf-xs-breakout-20-v1"]!.verdict, "NO_WINNER");
});

test("unknown strategy, missing required evidence and invalid inputs are rejected", () => {
  const unknown = evaluate(snap(), { "not-a-strategy": "BUY" });
  assert.ok(unknown.rejected.some((r) => r.reason === "unknown strategy"));
  const missing = evaluate(snap({ present: { bars: false, spy: true, macro: true, positioning: true } }), { "etf-xs-breakout-20-v1": "BUY" });
  assert.ok(missing.rejected.some((r) => r.reason.includes("NO_WINNER") || r.reason.includes("missing required")));
  const invalid = evaluate(snap({ close: Number.NaN, ownedQty: -1 }), { "synthetic-eligible-fixture": "BUY" });
  assert.ok(invalid.warden.includes("invalid numerical input"));
  assert.equal(invalid.tradingAuthorized, false);
});

test("ranking is deterministic and missing inputs are NOT_RANKABLE", () => {
  const ranked = evaluate(snap(), { "synthetic-eligible-fixture": "BUY" });
  assert.equal(ranked.ranking.scoreIsProbability, false);
  assert.equal(ranked.ranking.status, "NOT_RANKABLE");
  assert.equal(ranked.ranking.rows[0]?.reason, "no comparable strategy-performance evidence");
  const missingOptional = evaluate(snap({ present: { bars: true, spy: true, macro: false, positioning: true } }), { "synthetic-eligible-fixture": "BUY" });
  assert.equal(missingOptional.ranking.status, "NOT_RANKABLE");
  assert.equal(missingOptional.ranking.selected, null);
});

test("evidence status is not ACTIVE by default", () => {
  const d = evaluate(snap(), {}, { timeoutRoles: ["Oracle"] });
  assert.equal(d.evidence.find((e) => e.role === "Oracle")!.status, "UNAVAILABLE");
  assert.equal(d.evidence.find((e) => e.role === "Pulse")!.status, "UNAVAILABLE");
  assert.equal(d.evidence.find((e) => e.role === "Bull")!.status, "BLOCKED");
  assert.equal(d.evidence.find((e) => e.role === "Vector")!.status, "ACTUAL_ANALYSIS");
});

test("protective exit must match the owned position and does not wait for LLM", () => {
  const unrelated = evaluate(snap({ ownedQty: 1, ownedSymbol: "QQQ", ownedStrategyVersion: "synthetic-eligible-fixture" }), { "synthetic-eligible-fixture": "EXIT" }, { exitReason: "risk-reduction" });
  assert.equal(unrelated.recommendation, "NO_TRADE");
  const bound = evaluate(snap({ ownedQty: 1, ownedSymbol: "SPY", ownedStrategyVersion: "synthetic-eligible-fixture" }), { "synthetic-eligible-fixture": "EXIT" }, { billingLocked: true, exitReason: "risk-reduction" });
  assert.equal(bound.recommendation, "EXIT");
  assert.equal(bound.tradingAuthorized, false);
  assert.equal(bound.hermes.realPerformance, false);
});

test("stale data, correlation and unavailable providers fail closed", () => {
  assert.equal(evaluate(snap({ dataAgeMs: 60 * 60 * 1000 }), { "synthetic-eligible-fixture": "BUY" }).recommendation, "NO_TRADE");
  assert.equal(evaluate(snap({ correlatedExposure: 1 }), { "synthetic-eligible-fixture": "BUY" }).reason, "correlated exposure");
  assert.ok(evaluate(snap(), { "synthetic-eligible-fixture": "BUY" }, { timeoutRoles: ["Oracle"] }).warden.includes("unavailable agent"));
});
test("strong score on an unapproved strategy cannot trade", () => {
  const d = evaluate(snap(), { "etf-xs-breakout-20-v1": "BUY", "etf-weekly-momentum-v1": "BUY" });
  assert.equal(d.recommendation, "NO_TRADE");
  assert.equal(d.pilot.strategyApproved, false);
  assert.equal(d.sigmaVeto, true);
  assert.equal(LOGICAL_ROLES.length, 15);
  assert.equal(architectureReadiness().length, 6);
});
