import assert from "node:assert/strict";
import test from "node:test";
import { reconcile } from "./reconcile-paper.ts";
import { assertLiveReadOnly, prepareLiveReadOnly } from "./live-readonly.ts";

test("positions are compared by instrument", () => {
  const result = reconcile({ "BTC/USD": 0, "ETH/USD": 0 }, { account: { status: "ACTIVE", cash: "1" }, positions: [{ symbol: "BTC/USD", qty: "0.001" }, { symbol: "ETH/USD", qty: "-0.001" }], openOrders: [], recentOrders: [] }, []);
  assert.equal(result.ok, false);
  assert.match(result.notes.join(" "), /BTC\/USD/);
  assert.match(result.notes.join(" "), /ETH\/USD/);
});

test("live adapter cannot submit orders and is not activated", () => {
  const live = prepareLiveReadOnly();
  assert.equal(live.activated, false);
  assert.equal(live.canSubmit, false);
  assert.throws(() => assertLiveReadOnly("https://api.alpaca.markets/v2/orders"), /blocked/);
});
