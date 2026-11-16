import assert from "node:assert/strict";
import test from "node:test";
import { reconcileRecord, type LifecycleRecord } from "../src/lifecycle.ts";
import { MODE_GATE } from "../src/mode.ts";

const record = (over: Partial<LifecycleRecord> = {}): LifecycleRecord => ({
  clientOrderId: "synthetic",
  symbol: "SPY",
  side: "buy",
  qty: 0.02,
  state: "SUBMISSION_ATTEMPTED",
  filledQty: 0,
  linkedExitId: null,
  unknown: false,
  alerted: false,
  submitted: true,
  expiresAt: "2099-01-01T00:00:00Z",
  ...over,
});

test("submission attempt with a missing order is UNKNOWN and an empty book is not FLAT", () => {
  const missing = reconcileRecord(record(), {
    orderStatus: 404,
    orderBody: null,
    positionsStatus: 200,
    positions: [],
    openStatus: 200,
    openOrders: [],
  });
  assert.equal(missing.state, "UNKNOWN");
  assert.notEqual(missing.state, "FLAT");
  const proposed = reconcileRecord(record({ state: "PROPOSED", submitted: false }), {
    orderStatus: 404,
    orderBody: null,
    positionsStatus: 200,
    positions: [],
    openStatus: 200,
    openOrders: [],
  });
  assert.equal(proposed.state, "PROPOSED");
  assert.equal(MODE_GATE.paperPost, "DISABLED");
  assert.equal(MODE_GATE.livePost, "DISABLED");
  assert.equal(MODE_GATE.strategyApproved, false);
});
