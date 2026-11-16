import assert from "node:assert/strict";
import test from "node:test";
import { riskDecision } from "./risk-acceptance.ts";

test("missing Sigma or Sentinel fails closed", () => {
  const base = { sigmaApproved: true, sentinelApproved: true, buyingPower: 100, proposedNotional: 25, accountBlocked: false };
  assert.equal(riskDecision({ ...base, sigmaApproved: false }).allow, false);
  assert.equal(riskDecision({ ...base, sentinelApproved: false }).allow, false);
  assert.equal(riskDecision({ ...base, proposedNotional: 26 }).allow, false);
  assert.equal(riskDecision(base).allow, true);
});
