import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canExperiment } from "./registry.ts";

describe("research registry", () => {
  it("does not promote research or rejected work", () => {
    assert.equal(canExperiment("PAPER_EXPERIMENT", true, false), false);
    assert.equal(canExperiment("PAPER_EXPERIMENT", true, true), true);
    assert.equal(canExperiment("LIVE_APPROVED", true, true), false);
  });
});
