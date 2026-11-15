import assert from "node:assert/strict";
import test from "node:test";
import { isApexClientId, ordersUrl, reconcile } from "./reconcile-paper.ts";
import { assertLiveReadOnly, prepareLiveReadOnly } from "./live-readonly.ts";

const snap = {
  account: { status: "ACTIVE", cash: "1" },
  positions: [{ symbol: "BTC/USD", qty: "0" }],
  openOrders: [{ id: "open-1", client_order_id: "manual-user-order", status: "new" }],
  recentOrders: [{ id: "hist-1", client_order_id: "manual-user-order", status: "filled" }],
};

test("empty known IDs do not bypass Apex order matching", () => {
  const result = reconcile({ "BTC/USD": 0 }, { ...snap, openOrders: [{ id: "a1", client_order_id: "apex-missing-1", status: "new" }] }, []);
  assert.equal(result.ok, false);
  assert.match(result.notes.join(" "), /unmatched Apex order apex-missing-1/);
});

test("preexisting non-Apex orders are historical, not false alarms", () => {
  const result = reconcile({ "BTC/USD": 0 }, snap, []);
  assert.equal(result.ok, true);
  assert.equal(result.historical, 2);
  assert.equal(result.matched, 0);
});

test("known durable journal IDs match", () => {
  const result = reconcile({ "BTC/USD": 0 }, { ...snap, recentOrders: [{ id: "h1", client_order_id: "apex-smoke-buy-10ec7990-a0e7-4bc1-ba3c-4d1ce95860ff", status: "filled" }] }, ["apex-smoke-buy-10ec7990-a0e7-4bc1-ba3c-4d1ce95860ff"]);
  assert.equal(result.ok, true);
  assert.equal(result.matched, 1);
});

test("order history uses documented before_order_id pagination, not page", () => {
  const first = new URL(ordersUrl("https://paper-api.alpaca.markets"));
  const next = new URL(ordersUrl("https://paper-api.alpaca.markets", "abc"));
  assert.equal(first.searchParams.has("page"), false);
  assert.equal(first.searchParams.get("limit"), "50");
  assert.equal(first.searchParams.get("direction"), "desc");
  assert.equal(next.searchParams.get("before_order_id"), "abc");
});

test("live read-only is GET only, allowlisted, and uses separate credentials", () => {
  const live = prepareLiveReadOnly();
  assert.equal(live.method, "GET");
  assert.deepEqual(live.credentialEnv, ["LIVE_APCA_API_KEY_ID", "LIVE_APCA_API_SECRET_KEY"]);
  assert.throws(() => assertLiveReadOnly("https://api.alpaca.markets/v2/account", "POST"), /GET only/);
  assert.throws(() => assertLiveReadOnly("https://api.alpaca.markets/v2/orders", "GET"), /blocked/);
  assert.doesNotThrow(() => assertLiveReadOnly("https://api.alpaca.markets/v2/account?status=open", "GET"));
  assert.equal(isApexClientId("apex-smoke-1"), true);
  assert.equal(isApexClientId("manual-1"), false);
});
