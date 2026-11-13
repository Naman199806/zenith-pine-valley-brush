import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canSubmit, EXPERIMENT_ON, PAPER_BASE } from "./experiment.ts";

describe("paper experiment", () => {
  it("stays off and paper-only", () => {
    assert.equal(EXPERIMENT_ON, false);
    assert.equal(PAPER_BASE, "https://paper-api.alpaca.markets");
    assert.equal(canSubmit({ symbol: "BTC/USD", maxNotional: 100, operatorApproved: true, expires: "2026-11-14" }), "BLOCKED_EXPERIMENT_OFF");
  });
});
