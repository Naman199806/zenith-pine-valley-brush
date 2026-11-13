import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mockRoundTrip } from "./mock.ts";

describe("mock broker", () => {
  it("closes to zero and deducts fees", () => {
    const out = mockRoundTrip({ clientId: "mock-1", qty: 0.001, price: 70000, feeBps: 25 });
    assert.equal(out.position, 0);
    assert.ok(out.pnl < 0);
  });
});
