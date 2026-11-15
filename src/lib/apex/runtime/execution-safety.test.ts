import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyFill, assertProductionIsolation, emptySafety, persist, recordIntent, recover, rejectStop } from "./execution-safety.ts";
import { parseBrokerOrder, serializeOrder } from "../broker/paper-adapter.ts";
import { decide } from "./decision.ts";

const now = Date.parse("2026-11-15T07:00:00Z");
const fresh = [{ symbol: "BTC/USD", price: 65000, observedAt: "2026-11-15T06:58:00Z", source: "alpaca", session: "24/7" as const }];

test("fixture approval cannot enter production config", () => {
  assert.throws(() => assertProductionIsolation({ fixtureApproval: true }), /fixtureApproval/);
  assertProductionIsolation({});
});

test("complete mock lifecycle journals fills and reconciles", () => {
  const dir = mkdtempSync(join(tmpdir(), "apex-"));
  const path = join(dir, "journal.json");
  const decision = decide({ nowMs: now, quotes: fresh, strategy: { id: "fixture-only", spec: { rule: "test" }, signal: "BUY", approved: true }, fixtureApproval: true, authorizationExpiresAt: "2026-11-15T08:00:00Z", cash: 1000, price: 65000 });
  let state = emptySafety(1000);
  state = recordIntent(state, { clientOrderId: decision.traceId, traceId: decision.traceId, side: "buy", qty: decision.pilot.qty, price: 65000, state: "INTENT", createdAt: "2026-11-15T07:00:00Z" });
  state = applyFill(state, decision.traceId, decision.pilot.qty, 65000);
  state = recordIntent(state, { clientOrderId: `${decision.traceId}-exit`, traceId: decision.traceId, side: "sell", qty: decision.pilot.qty, price: 64900, state: "INTENT", createdAt: "2026-11-15T07:01:00Z" });
  state = applyFill(state, `${decision.traceId}-exit`, decision.pilot.qty, 64900);
  persist(path, state);
  const restored = recover(path);
  assert.equal(restored.position, 0);
  assert.equal(restored.journal.some((e) => e.type === "FILL"), true);
  assert.equal(restored.journal.some((e) => e.type === "RECOVERY"), true);
  assert.throws(() => recordIntent(restored, { clientOrderId: decision.traceId, traceId: decision.traceId, side: "buy", qty: 1, price: 1, state: "INTENT", createdAt: "2026-11-15T07:02:00Z" }), /duplicate/);
});

test("rejected stop blocks new entries and keeps exposure visible", () => {
  let state = emptySafety(1000);
  state = recordIntent(state, { clientOrderId: "buy-1", traceId: "t1", side: "buy", qty: 0.0001, price: 65000, state: "INTENT", createdAt: "2026-11-15T07:00:00Z" });
  state = applyFill(state, "buy-1", 0.0001, 65000);
  state = rejectStop(state, "stop-1");
  assert.equal(state.entriesBlocked, true);
  assert.match(state.alert || "", /new entries blocked/);
  assert.equal(state.position, 0.0001);
  assert.throws(() => recordIntent(state, { clientOrderId: "buy-2", traceId: "t2", side: "buy", qty: 0.0001, price: 65000, state: "INTENT", createdAt: "2026-11-15T07:03:00Z" }), /blocked/);
});

test("paper order serialization stays on the paper endpoint", () => {
  const order = serializeOrder({ symbol: "BTC/USD", qty: 0.00015384615, side: "buy", clientOrderId: "abc-1" });
  assert.equal(order.url, "https://paper-api.alpaca.markets/v2/orders");
  assert.equal(order.body.qty, "0.00015384");
  const parsed = parseBrokerOrder({ id: "ord-1", client_order_id: "abc-1", status: "filled", filled_qty: "0.00015384" });
  assert.equal(parsed.filledQty, 0.00015384);
});
