import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ROLE_STATUS } from "./role-status.ts";

describe("12-role status", () => {
  it("labels all twelve with accurate live-research semantics", () => {
    assert.equal(ROLE_STATUS.length, 12);
    assert.equal(ROLE_STATUS.filter((row) => row.status === "UNAVAILABLE").length, 4);
    assert.equal(ROLE_STATUS.find((row) => row.id === "risk")?.status, "RULE_BASED");
    assert.equal(ROLE_STATUS.find((row) => row.id === "bear")?.status, "REAL_MODEL");
    assert.equal(ROLE_STATUS.find((row) => row.id === "bear")?.consumed, true);
    assert.equal(ROLE_STATUS.find((row) => row.id === "bull")?.status, "ERROR");
    assert.equal(ROLE_STATUS.find((row) => row.id === "bull")?.modelCall, true);
    assert.equal(ROLE_STATUS.find((row) => row.id === "bull")?.consumed, false);
    const notLive = ROLE_STATUS.filter((row) => !["bull", "bear"].includes(row.id));
    assert.equal(notLive.every((row) => row.modelCall === false), true);
  });
});
