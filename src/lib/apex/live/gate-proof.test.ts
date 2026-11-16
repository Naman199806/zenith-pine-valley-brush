import assert from "node:assert/strict";
import test from "node:test";
import { issueGateProof, verifyGateProof } from "./executor.ts";

const SECRET = "test-only-gate-secret-32chars-min";
const bind = { singleUseId: "g1", symbol: "SPY", side: "buy" as const, qty: 0.01, limitPrice: 500 };

test("gate proof fails closed without a 32-character secret and rejects a forged HMAC", () => {
  assert.equal(issueGateProof(bind, { dataIntegrityOk: true, riskOk: true, notional: 10 }, new Date(), null), null);
  assert.equal(issueGateProof(bind, { dataIntegrityOk: true, riskOk: true, notional: 10 }, new Date(), "short"), null);
  const issued = issueGateProof(bind, { dataIntegrityOk: true, riskOk: true, notional: 10 }, new Date(), SECRET);
  assert.ok(issued);
  assert.equal(verifyGateProof(issued, bind, Date.now(), 30_000, SECRET), null);
  const forged = { ...issued!, proof: "0".repeat(64) };
  assert.ok(verifyGateProof(forged, bind, Date.now(), 30_000, SECRET));
  assert.ok(verifyGateProof(issued, bind, Date.now(), 30_000, null)?.includes("fail closed"));
});
