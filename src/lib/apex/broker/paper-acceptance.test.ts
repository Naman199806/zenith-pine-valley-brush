import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

test("PAPER acceptance uses real order IDs, fills, and a confirmed flat position", () => {
  const buy = JSON.parse(readFileSync("research/lab/paper-smoke-buy-final.json", "utf8"));
  const sell = JSON.parse(readFileSync("research/lab/paper-smoke-sell-final.json", "utf8"));
  assert.match(buy.id, /^[0-9a-f-]{36}$/);
  assert.equal(buy.status, "filled");
  assert.ok(Number(buy.filled_qty) > 0);
  assert.match(sell.sell.id, /^[0-9a-f-]{36}$/);
  assert.equal(sell.sell.status, "filled");
  assert.equal(sell.sell.side, "sell");
  assert.deepEqual(sell.positions, []);
  assert.deepEqual(sell.open, []);
  assert.notEqual(buy.client_order_id, sell.sell.client_order_id);
});
