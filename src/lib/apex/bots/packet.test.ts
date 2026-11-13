import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { btcPacket, completedBars } from "./packet.ts";

describe("research packet", () => {
  it("gives Bear real completed bars and marks missing fields", () => {
    const packet = btcPacket();
    const done = completedBars(packet);
    assert.equal(done.length, 1);
    assert.equal(done[0].close, 71369.9);
    assert.equal(packet.missing.includes("news"), true);
    assert.equal(packet.options.length, 0);
  });
});
