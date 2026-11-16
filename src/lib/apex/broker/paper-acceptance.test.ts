import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const FIX = "research/fixtures/paper";

test("committed BTC PAPER fixtures are authentic, sanitized, and not equity evidence", () => {
  const buy = JSON.parse(readFileSync(`${FIX}/btc-buy-final.json`, "utf8"));
  const sell = JSON.parse(readFileSync(`${FIX}/btc-sell-final.json`, "utf8"));
  const prov = JSON.parse(readFileSync(`${FIX}/provenance.json`, "utf8"));
  assert.equal(buy.symbol, "BTC/USD");
  assert.equal(buy.asset_class, "crypto");
  assert.equal(buy.status, "filled");
  assert.ok(Number(buy.filled_qty) > 0);
  assert.equal(buy.filled_at, prov.buy.filled_at);
  assert.equal(sell.sell.symbol, "BTC/USD");
  assert.equal(sell.sell.status, "filled");
  assert.deepEqual(sell.positions, []);
  assert.deepEqual(sell.open, []);
  assert.equal(prov.notEquity, true);
  assert.equal(prov.freshGetVerification, "NOT_PERFORMED");
  assert.notEqual(buy.id, sell.sell.id);
});

test("US ETF PAPER acceptance is not inferred from crypto fills", () => {
  const prov = JSON.parse(readFileSync(`${FIX}/provenance.json`, "utf8"));
  assert.equal(prov.symbol, "BTC/USD");
  assert.notEqual(prov.assetClass, "us_equity");
  for (const symbol of ["SPY", "QQQ", "IWM"]) {
    assert.notEqual(prov.symbol, symbol);
  }
});
