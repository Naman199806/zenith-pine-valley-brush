import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { due, exitOwned } from "./hold.ts";

describe("hold timer", () => {
  it("exits only owned quantity after five minutes", () => {
    assert.equal(due(0, 4 * 60 * 1000), false);
    assert.equal(due(0, 5 * 60 * 1000), true);
    assert.equal(exitOwned(0.00029).qty, 0.00029);
    assert.equal(exitOwned(0).flat, false);
  });
});
