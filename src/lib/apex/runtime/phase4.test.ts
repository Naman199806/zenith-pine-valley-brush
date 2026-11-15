import assert from "node:assert/strict";
import test from "node:test";
import { candleCloseMs, decide } from "./decision.ts";
import { MockBroker } from "./mock-broker.ts";

const now = Date.parse("2026-11-15T06:54:00Z");
const fresh = [{ symbol: "BTC/USD", price: 65000, observedAt: "2026-11-15T06:50:00Z", source: "alpaca", session: "24/7" as const }];

test("bar freshness uses candle close, not open timestamp", () => {
  assert.equal(candleCloseMs("2026-11-15T06:30:00Z"), Date.parse("2026-11-15T06:45:00Z"));
});

test("future observation is unavailable and cannot buy", () => {
  const decision = decide({ nowMs: now, quotes: [{ symbol: "BTC/USD", price: 1, observedAt: "2026-11-15T08:00:00Z", source: "alpaca", session: "24/7" }], strategy: { id: "fixture", spec: { a: 1 }, signal: "BUY", approved: true }, fixtureApproval: true, authorizationExpiresAt: "2026-11-15T07:00:00Z" });
  assert.equal(decision.dataQuality, "UNAVAILABLE");
  assert.equal(decision.decision, "NO_TRADE");
});

test("fixture approval can reach a mock order and billing lock does not block exit", () => {
  const decision = decide({ nowMs: now, quotes: fresh, strategy: { id: "fixture-only", spec: { rule: "test" }, signal: "BUY", approved: true }, fixtureApproval: true, authorizationExpiresAt: "2026-11-15T07:00:00Z", cash: 1000, price: 65000 });
  assert.equal(decision.decision, "BUY");
  assert.equal(decision.brokerWrites, 0);
  const broker = new MockBroker();
  const buy = broker.submit(decision.traceId, "buy", decision.pilot.qty, 65000);
  assert.equal(buy.status, "filled");
  const exit = decide({ nowMs: now, quotes: fresh, strategy: { id: "fixture-only", spec: { rule: "test" }, signal: "EXIT", approved: true }, fixtureApproval: true, authorizationExpiresAt: "2026-11-15T07:00:00Z", ownedQty: buy.filled, price: 64900 });
  assert.equal(exit.decision, "EXIT");
  const sell = broker.submit(`${decision.traceId}-exit`, "sell", exit.pilot.qty, 64900);
  assert.equal(broker.position, 0);
  assert.equal(sell.filled, buy.filled);
});

test("duplicate client ids and stop rejection are reconciled", () => {
  const broker = new MockBroker(true);
  const partial = broker.submit("same", "buy", 0.0002, 65000);
  assert.equal(partial.status, "partial");
  assert.throws(() => broker.submit("same", "buy", 0.0002, 65000), /duplicate/);
  broker.failNextStop = true;
  const rejected = broker.submit("stop-1", "sell", partial.filled, 64000);
  assert.equal(rejected.status, "rejected");
  assert.equal(broker.position, partial.filled);
});

test("production flags stay no-trade", () => {
  const decision = decide({ nowMs: now, quotes: fresh, strategy: { id: "fixture-only", spec: { rule: "test" }, signal: "BUY", approved: true }, authorizationExpiresAt: "2026-11-15T07:00:00Z" });
  assert.equal(decision.decision, "NO_TRADE");
  assert.equal(decision.sentinel, "VETO");
});
