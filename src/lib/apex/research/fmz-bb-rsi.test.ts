import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { completedBars, evaluateFmz, type Bar } from "./fmz-bb-rsi.ts";
import { pilotEntryCount, recoverRejectedEntry } from "./pilot-ledger.ts";

function bars(n: number, fn: (i: number) => number, start = Date.UTC(2026, 0, 1)): Bar[] {
  return Array.from({ length: n }, (_, i) => {
    const c = fn(i);
    return { t: new Date(start + i * 15 * 60 * 1000).toISOString(), o: c, h: c + 1, l: c - 1, c };
  });
}

describe("FMZ completed candles and boundaries", () => {
  it("drops an incomplete 15-minute candle", () => {
    const all = bars(3, () => 100);
    const now = Date.parse(all[1].t) + 15 * 60 * 1000;
    assert.equal(completedBars(all, now).length, 2);
  });

  it("waits until 250 completed bars exist", () => {
    const out = evaluateFmz(bars(10, (i) => 100 + i), 250, Date.parse("2027-01-01T00:00:00Z"));
    assert.equal(out.signal, "WAIT");
  });

  it("does not buy on a level touch without a cross", () => {
    const out = evaluateFmz(bars(260, () => 100), 250, Date.parse("2027-01-01T00:00:00Z"));
    assert.equal(out.signal, "WAIT");
  });

  it("treats equality as a cross boundary, not an interior touch", () => {
    const sample = bars(260, (i) => 100 + (i === 259 ? 1 : 0));
    const out = evaluateFmz(sample, 250, Date.parse("2027-01-01T00:00:00Z"));
    assert.equal(out.prevRsi != null && out.rsi != null, true);
    assert.equal(out.signal, "WAIT");
  });
});

describe("pilot ledger", () => {
  it("counts only filled buys after activation", () => {
    const n = pilotEntryCount([
      { client_order_id: "apex-old", side: "buy", status: "filled", submitted_at: "2026-11-14T02:05:37Z" },
      { client_order_id: "apex-new", side: "buy", status: "filled", submitted_at: "2026-11-14T04:00:00Z" },
      { client_order_id: "apex-rej", side: "buy", status: "rejected", submitted_at: "2026-11-14T04:10:00Z" },
    ], "2026-11-14T03:05:00.000Z");
    assert.equal(n, 1);
  });

  it("does not retry a rejected entry", () => {
    assert.equal(recoverRejectedEntry("apex-1", "rejected"), "REJECTED_NO_RETRY");
    assert.equal(recoverRejectedEntry("apex-1", null), "LOOKUP_REQUIRED");
  });
});
