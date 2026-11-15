import assert from "node:assert/strict";
import test from "node:test";
import { ROLES, runCanonicalDecision, counterfactual, type StrategyProposal } from "./canonical-decision.ts";

const base = (over: Partial<StrategyProposal> = {}): StrategyProposal => ({
  strategyVersion: "etf-xs-breakout-20-v1",
  symbol: "SPY",
  signal: "BUY",
  asOf: "2024-06-14T20:00:00Z",
  provenance: "yahoo-chart-v8:SPY checksum recorded",
  dataOk: true,
  ownedQty: 0,
  filledQty: 0,
  openExitQty: 0,
  proposedNotional: 25,
  ...over,
});

test("all 13 roles are invoked; Bull and Bear are blocked with no inference", () => {
  const t = runCanonicalDecision(base());
  assert.equal(t.roles.length, 13);
  assert.deepEqual(t.roles.map((r) => r.role), [...ROLES]);
  assert.ok(t.roles.every((r) => r.invoked));
  const bull = t.roles.find((r) => r.role === "Bull")!;
  const bear = t.roles.find((r) => r.role === "Bear")!;
  assert.equal(bull.mode, "BLOCKED");
  assert.equal(bear.mode, "BLOCKED");
  assert.equal(bull.output.inference, false);
  assert.equal(t.executionAuthorized, false);
});

test("eligible BUY passes research gates but is not execution-authorized", () => {
  const t = runCanonicalDecision(base());
  assert.equal(t.researchRecommendation, "BUY");
  assert.equal(t.quantRejects, false);
  assert.equal(t.riskRejects, false);
  assert.equal(t.executionAuthorized, false);
  assert.equal(t.hermes.recorded, true);
  assert.ok(t.hermes.clientOrderId);
});

test("Sigma veto cannot be overridden by research", () => {
  const t = runCanonicalDecision(base({ dataOk: false }));
  assert.equal(t.researchRecommendation, "NO_TRADE");
  assert.equal(t.quantRejects, true);
  assert.equal(t.roles.find((r) => r.role === "Sigma")!.contribution, "VETO");
  assert.equal(t.executionAuthorized, false);
});

test("Sentinel veto on oversized notional and conflicting exit", () => {
  const big = runCanonicalDecision(base({ proposedNotional: 50 }));
  assert.equal(big.riskRejects, true);
  assert.equal(big.researchRecommendation, "NO_TRADE");
  const exit = runCanonicalDecision(base({ signal: "EXIT", ownedQty: 0.1, filledQty: 0.05, openExitQty: 0.05 }));
  assert.equal(exit.riskRejects, true);
  assert.equal(exit.researchRecommendation, "NO_TRADE");
});

test("EXIT for owned partial fill is accepted as research only", () => {
  const t = runCanonicalDecision(base({ signal: "EXIT", ownedQty: 0.02, filledQty: 0.02, openExitQty: 0 }));
  assert.equal(t.researchRecommendation, "EXIT");
  assert.equal(t.executionAuthorized, false);
  assert.equal(t.roles.find((r) => r.role === "Sentinel")!.contribution, "ADVISORY_ONLY");
});

test("counterfactual: removing Vector changes BUY to NO_TRADE", () => {
  const withVector = runCanonicalDecision(base());
  const without = counterfactual(base(), "Vector");
  assert.equal(withVector.researchRecommendation, "BUY");
  assert.equal(without.researchRecommendation, "NO_TRADE");
  assert.equal(without.reason, "Strategy WAIT.");
});

test("counterfactual: Bull has no measurable contribution", () => {
  const t = runCanonicalDecision(base());
  const bull = t.roles.find((r) => r.role === "Bull")!;
  assert.equal(bull.contribution, "BLOCKED");
  assert.notEqual(bull.contribution, "CHANGED_DECISION");
});

test("trace contains version, timestamp, provenance and Hermes record", () => {
  const t = runCanonicalDecision(base());
  assert.equal(t.strategyVersion, "etf-xs-breakout-20-v1");
  assert.equal(t.asOf, "2024-06-14T20:00:00Z");
  assert.ok(t.provenance.includes("yahoo"));
  assert.equal(t.hermes.recorded, true);
});
