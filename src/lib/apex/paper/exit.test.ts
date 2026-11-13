import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { exitBeforeSubmit, lostExitAck, reconcileExit, reloadExit } from "./exit.ts";
import { applyFill, exitQty } from "./fills.ts";

describe("exit and partials", () => {
  it("recovers a lost exit ack with the same id", () => {
    exitBeforeSubmit(0.001);
    const lost = lostExitAck();
    assert.equal(lost.state, "UNKNOWN");
    const again = reloadExit();
    assert.equal(again.clientId, "mock-exit-1");
    const done = reconcileExit(true);
    assert.equal(done.owned, 0);
  });

  it("tracks a partial and will not sell more than owned", () => {
    const part = applyFill(0.001, 0.0004);
    assert.equal(part.remaining, 0.0006);
    assert.equal(exitQty(part.owned, 0.001), 0.0004);
  });
});
