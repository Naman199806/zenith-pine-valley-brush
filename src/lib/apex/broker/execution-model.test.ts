import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nextOpenFill, noLookahead } from "./execution-model.ts";

const bars = [
  { date: "2024-01-02", open: 100, close: 101 },
  { date: "2024-01-03", open: 102, close: 103 },
];

describe("execution model fixtures", () => {
  it("fills the next session open and never the signal close", () => {
    const fill = nextOpenFill(bars, 0, { signalOn: "completed-close", fillOn: "next-open", feeBps: 25, spreadBps: 0, slippageBps: 0 });
    assert.equal(fill?.date, "2024-01-03");
    assert.ok(fill && fill.price > 102);
    assert.notEqual(fill?.price, 101);
  });

  it("rejects a fill that uses a future bar", () => {
    assert.equal(noLookahead(0, 0), true);
    assert.equal(noLookahead(0, 1), false);
  });

  it("returns null when there is no next session", () => {
    assert.equal(nextOpenFill(bars, 1, { signalOn: "completed-close", fillOn: "next-open", feeBps: 0, spreadBps: 0, slippageBps: 0 }), null);
  });
});
