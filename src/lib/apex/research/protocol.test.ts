import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { discussion, independentPass, budget } from "./protocol.ts";

describe("research protocol", () => {
  it("creates 13 submissions and no invented conversations", () => {
    const messages = independentPass("cycle-1");
    assert.equal(messages.length, 13);
    assert.equal(messages.every((m) => m.type === "submission" && m.destination === "decision"), true);
    assert.equal(discussion("cycle-1", "r1", "", "bear").length, 0);
  });

  it("keeps the paid flag false under the token budget", () => {
    assert.equal(budget(500).paid, false);
    assert.equal(budget(5000).ok, false);
  });
});
