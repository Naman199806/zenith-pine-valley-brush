import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { prepareEquityPaperTicket, verifyPaperOrders } from "./paper-verify.ts";

test("overnight snapshot is historical and not reusable as a fresh quote", () => {
  const snap = JSON.parse(readFileSync("research/lab/overnight-quote-snapshot.json", "utf8"));
  assert.equal(snap.kind, "HISTORICAL_READ_ONLY_SNAPSHOT");
  assert.equal(snap.reusableAsFreshQuote, false);
  assert.equal(snap.executionAuthorization, false);
  assert.equal(snap.quotes.SPY.bid, 753.96);
  assert.equal(snap.quotes.QQQ.spreadBps, 15.18);
  assert.equal(snap.quotes.IWM.ageSeconds, 1.8);
  assert.equal(snap.account.buyingPower, 100);
  assert.equal(snap.account.positions, 0);
});

test("PAPER verification is GET-only and rejects the LIVE host", () => {
  const blocked = verifyPaperOrders({ authorized: true, host: "https://api.alpaca.markets", orders: [], positions: [], openOrders: [] });
  assert.equal(blocked.verified, false);
  assert.ok(blocked.blockers.includes("LIVE host rejected"));
  assert.equal(blocked.submitted, false);
  const ready = verifyPaperOrders({
    authorized: true,
    host: "paper-api.alpaca.markets",
    orders: [{ id: "9633330d-cb0f-4f71-ab56-90add657cfbf", client_order_id: "apex-smoke-buy", symbol: "BTC/USD", side: "buy", status: "filled", filled_qty: "0.000151417" }],
    positions: [],
    openOrders: [],
  });
  assert.equal(ready.verified, true);
  assert.equal(ready.method, "GET");
});

test("ETF PAPER ticket is prepared and not authorized", () => {
  const t = prepareEquityPaperTicket();
  assert.equal(t.status, "PREPARED_NOT_AUTHORIZED");
  assert.equal(t.maxEntryNotional, 25);
  assert.equal(t.requiresFreshQuote, true);
  assert.equal(t.submitted, false);
  assert.equal(t.executionAuthorized, false);
  assert.equal(t.independentExitAuth, true);
});
