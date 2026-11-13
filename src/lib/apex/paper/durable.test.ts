import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { closeRecovered, openPosition, recover } from "./durable.ts";

describe("restart recovery", () => {
  it("reloads an open position and then closes it", () => {
    const opened = openPosition();
    assert.equal(opened.status, "OPEN");
    const again = recover();
    assert.equal(again.clientId, "mock-exp-1");
    assert.equal(again.qty, 0.001);
    const closed = closeRecovered();
    assert.equal(closed.status, "FLAT");
    assert.equal(closed.qty, 0);
  });
});
