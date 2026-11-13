import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nextState } from "./controller.ts";

describe("paper controller", () => {
  it("blocks unattended entry while paper auto is off", () => {
    assert.equal(nextState("PROPOSED", false), "POLICY_BLOCKED");
  });
});
