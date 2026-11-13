import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { intentBeforeSubmit, lostResponse, reconcile, reload } from "./unknown.ts";

describe("unknown order", () => {
  it("keeps the same id and freezes entries after a lost response", () => {
    const before = intentBeforeSubmit();
    assert.equal(before.state, "SUBMITTING");
    const lost = lostResponse();
    assert.equal(lost.state, "UNKNOWN");
    assert.equal(lost.newEntries, false);
    const again = reload();
    assert.equal(again.clientId, "mock-unknown-1");
    const found = reconcile(true);
    assert.equal(found.state, "ACKNOWLEDGED");
    assert.equal(found.clientId, before.clientId);
  });
});
