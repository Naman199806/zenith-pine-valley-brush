import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { completedBars } from "./completed.ts";

describe("completed candles", () => {
  it("rejects the incomplete 2026-11-13 bar", () => {
    const bars = [
      { ts: 1762905600, close: 1 },
      { ts: 1794528000, close: 2 },
    ];
    const done = completedBars(bars, "2026-11-13");
    assert.equal(done.length, 1);
    assert.equal(done[0]?.ts, 1762905600);
  });
});
