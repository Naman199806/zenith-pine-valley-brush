import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ROLE_STATUS } from "./role-status.ts";

describe("12-role status", () => {
  it("labels all twelve and never claims a model call", () => {
    assert.equal(ROLE_STATUS.length, 12);
    assert.equal(ROLE_STATUS.every((row) => row.modelCall === false), true);
    assert.equal(ROLE_STATUS.filter((row) => row.status === "UNAVAILABLE").length, 4);
    assert.equal(ROLE_STATUS.filter((row) => row.status === "REAL_MODEL").length, 2);
    assert.equal(ROLE_STATUS.find((row) => row.id === "risk")?.status, "RULE_BASED");
  });
});
