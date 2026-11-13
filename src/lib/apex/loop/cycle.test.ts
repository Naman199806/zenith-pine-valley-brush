import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cycle } from "./cycle.ts";

describe("decision cycle", () => {
  it("does not force a buy", () => {
    const out = cycle("BTC-USD", false, false);
    assert.equal(out.proposal, "NO_TRADE");
    assert.equal(out.orderSent, false);
    assert.equal(out.paperAuto, false);
    assert.equal(out.agentChanged, false);
  });
});
