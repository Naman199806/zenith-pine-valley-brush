import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { replaceAtomic, sessionStatus, snapshot } from "./live.ts";

describe("market refresh", () => {
  it("does not label a closed-session equity quote as fresh", async () => {
    const body = JSON.stringify({ chart: { result: [{ meta: { regularMarketPrice: 100, regularMarketTime: 1763000000 } }] } });
    const closed = Date.parse("2026-11-14T02:00:00Z");
    const out = await snapshot(async (url) => new Response(String(url).includes("yahoo") ? body : "[]", { status: 200 }), closed);
    const spy = out.quotes.find((q) => q.symbol === "SPY");
    assert.equal(sessionStatus(closed), "CLOSED");
    assert.notEqual(spy?.status, "FRESH");
    assert.equal(spy?.status, "DELAYED");
  });

  it("keeps last-known data when a provider fails and replaces atomically", async () => {
    const good = await snapshot(async (url) => new Response(String(url).includes("yahoo") ? JSON.stringify({ chart: { result: [{ meta: { regularMarketPrice: 10, regularMarketTime: 1763000000 } }] } }) : "[]", { status: 200 }), Date.parse("2026-11-13T15:00:00Z"));
    const failed = await snapshot(async () => new Response("no", { status: 503 }), Date.parse("2026-11-13T15:01:00Z"), good.quotes);
    const next = replaceAtomic(good, failed);
    assert.equal(next.attempts, 2);
    assert.equal(next.quotes.find((q) => q.symbol === "SPY")?.price, 10);
    assert.equal(next.quotes.find((q) => q.symbol === "BTC/USD")?.status, "UNAVAILABLE");
  });
});
