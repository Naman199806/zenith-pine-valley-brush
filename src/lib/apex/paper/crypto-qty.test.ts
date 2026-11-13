import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { executePaperEntry } from "../broker/client.ts";
import { floorExitQty } from "./crypto-qty.ts";

describe("crypto quantity", () => {
  it("floors an exit and never rounds up", () => {
    assert.equal(floorExitQty(0.00029, 0.000001), 0.00029);
    assert.equal(floorExitQty(0.0002904, 0.000001), 0.00029);
    assert.equal(floorExitQty(0, 0.000001), 0);
  });

  it("accepts a fractional BTC close and still rejects a fractional stock close", async () => {
    const transport = { async call() { return { status: 404, body: {} }; } };
    const creds = { keyId: "k", secret: "s" };
    const base = { entryPriceCents: 6_880_630, stopPriceCents: 6_800_000, equityCents: 10_000_000, cashCents: 10_000_000, openPositions: 0, entriesToday: 0, dayDrawdown: 0, minuteEt: 600, dataOk: true, emergency: false, duplicate: false, mode: "PAPER_MANUAL" as const, operatorConfirmed: true, autoApproved: false, blockOrders: false };
    const btc = await executePaperEntry(transport, creds, { ...base, symbol: "BTC/USD", side: "sell", closing: true, closeQty: 0.00029 }, "2026-11-13T18:54:00Z", "a");
    const spy = await executePaperEntry(transport, creds, { ...base, symbol: "SPY", side: "sell", closing: true, closeQty: 0.5 }, "2026-11-13T18:54:00Z", "b");
    assert.notEqual(btc.reason, "There is no crypto quantity to close.");
    assert.equal(spy.reason, "There is no long to close.");
  });
});