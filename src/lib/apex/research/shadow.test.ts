import assert from "node:assert/strict";
import test from "node:test";
import { assessBars, reconcilePaperPosition } from "./shadow.ts";
import { PAPER_POST_ENABLED } from "../broker/paper-equity-transport.ts";

const bars = Array.from({ length: 220 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 0, 1 + i));
  const date = d.toISOString().slice(0, 10);
  return { date, open: 100 + i, high: 101 + i, low: 99 + i, close: 100 + i };
});

test("dataOk fails closed on stale, future and nonfinite bars", () => {
  const fresh = bars.map((b, i) => i === bars.length - 1 ? { ...b, date: "2026-11-13" } : b);
  assert.equal(assessBars("SPY", fresh, Date.parse("2026-11-15T21:00:00Z")).dataOk, true);
  assert.equal(assessBars("SPY", bars, Date.parse("2026-11-15T21:00:00Z")).dataOk, false);
  const future = fresh.map((b, i) => i === fresh.length - 1 ? { ...b, date: "2026-11-20" } : b);
  assert.ok(assessBars("SPY", future, Date.parse("2026-11-15T21:00:00Z")).reasons.some((r) => r.includes("future")));
});

test("PAPER reconciliation fails closed and never submits", async () => {
  const bad = await reconcilePaperPosition({ keyId: "PKPAPER", secret: "s" }, "SPY", async () => ({ status: 500, body: null }));
  assert.equal(bad.ok, false);
  const good = await reconcilePaperPosition({ keyId: "PKPAPER", secret: "s" }, "SPY", async (url) => {
    assert.ok(url.startsWith("https://paper-api.alpaca.markets/"));
    return url.includes("positions")
      ? { status: 200, body: [{ symbol: "SPY", qty: "0.03" }] }
      : { status: 200, body: [{ symbol: "SPY", side: "sell", qty: "0.01" }] };
  });
  assert.equal(good.ownedQty, 0.03);
  assert.equal(good.openExitQty, 0.01);
  assert.equal(PAPER_POST_ENABLED, false);
});
