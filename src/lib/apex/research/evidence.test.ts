import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { btcEvidence } from "./evidence.ts";

describe("evidence bundle", () => {
  it("carries an id and completed closes", () => {
    const ev = btcEvidence();
    assert.equal(ev.id, "btc-daily-20261112");
    assert.equal(ev.closes.length, 5);
    assert.equal(ev.lastCompleted, "2026-11-12");
  });
});
