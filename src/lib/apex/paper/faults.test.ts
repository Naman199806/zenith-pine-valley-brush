import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FAULTS } from "./faults.ts";

describe("fault matrix", () => {
  it("does not mark unrun cases as pass", () => {
    assert.ok(FAULTS.some((row) => row.result === "BLOCKED"));
    assert.equal(FAULTS.find((row) => row.name === "failed-entry")?.result, "PASS");
  });
});
