import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { preparePaperLimit, validatePaperLimit, type PaperLimitTicket } from "./paper-equity-transport.ts";
import { HermesJournal, MockBroker } from "../live/journal.ts";
import { architectureReadiness } from "../live/architecture.ts";
import { agentRoleStatus } from "../live/connectivity.ts";

const now = Date.parse("2026-11-16T15:00:00Z");
const ticket = (over: Partial<PaperLimitTicket> = {}): PaperLimitTicket => ({
  symbol: "SPY",
  side: "buy",
  orderType: "limit",
  timeInForce: "day",
  qty: 0.03,
  limitPrice: 750,
  session: "REGULAR",
  clientOrderId: "apex-spy-unique",
  expiresAt: "2026-11-16T16:00:00-05:00",
  operatorAuthorized: true,
  sigmaApproved: true,
  sentinelApproved: true,
  quoteTimestamp: new Date(now).toISOString(),
  quoteSpreadBps: 5,
  exitAuthorizationId: null,
  ...over,
});

test("default path persists intent and does not submit", async () => {
  const dir = mkdtempSync(join(tmpdir(), "paper-eq-"));
  const j = new HermesJournal(join(dir, "j.json"));
  const r = await preparePaperLimit(ticket(), j, { now });
  assert.equal(r.enabled, false);
  assert.equal(r.submitted, false);
  assert.equal(r.intentPersisted, true);
  assert.equal(r.host, "paper-api.alpaca.markets");
  rmSync(dir, { recursive: true, force: true });
});

test("authorization, gates, stale quote, spread and expiry fail closed", () => {
  assert.ok(validatePaperLimit(ticket({ operatorAuthorized: false }), now));
  assert.ok(validatePaperLimit(ticket({ sigmaApproved: false }), now));
  assert.ok(validatePaperLimit(ticket({ sentinelApproved: false }), now));
  assert.ok(validatePaperLimit(ticket({ quoteTimestamp: new Date(now - 10_000).toISOString() }), now));
  assert.ok(validatePaperLimit(ticket({ quoteSpreadBps: 50 }), now));
  assert.ok(validatePaperLimit(ticket({ qty: 1, limitPrice: 750 }), now));
  assert.ok(validatePaperLimit(ticket({ expiresAt: "2020-01-01T00:00:00Z" }), now));
});

test("duplicate client id is blocked and restart sees the journal", async () => {
  const dir = mkdtempSync(join(tmpdir(), "paper-eq-"));
  const path = join(dir, "j.json");
  const j = new HermesJournal(path);
  await preparePaperLimit(ticket(), j, { now });
  const again = await preparePaperLimit(ticket(), j, { now });
  assert.ok(again.reason.includes("duplicate"));
  const restarted = new HermesJournal(path);
  assert.ok(restarted.get("apex-spy-unique"));
  rmSync(dir, { recursive: true, force: true });
});

test("mock partial fill, cancel, independent sell and flat", async () => {
  const dir = mkdtempSync(join(tmpdir(), "paper-eq-"));
  const j = new HermesJournal(join(dir, "j.json"));
  const broker = new MockBroker();
  const buy = await preparePaperLimit(ticket({ clientOrderId: "buy-1" }), j, { now, enabled: true, transport: { post: async () => ({ status: 200 }) } });
  assert.equal(buy.submitted, true);
  broker.submit("buy-1", "buy", 0.03, "SPY");
  broker.partialFill("buy-1", 0.01);
  assert.ok(Math.abs(broker.getPosition() - 0.01) < 1e-9);
  broker.complete("buy-1");
  const sell = await preparePaperLimit(ticket({ side: "sell", clientOrderId: "sell-1", exitAuthorizationId: "exit-1" }), j, { now });
  assert.equal(sell.intentPersisted, true);
  assert.equal(sell.submitted, false);
  broker.submit("sell-1", "sell", 0.03, "SPY");
  assert.equal(broker.getPosition(), 0);
  assert.equal(broker.openOrders(), 0);
  rmSync(dir, { recursive: true, force: true });
});

test("unknown timeout is not resubmitted", async () => {
  const dir = mkdtempSync(join(tmpdir(), "paper-eq-"));
  const j = new HermesJournal(join(dir, "j.json"));
  const r = await preparePaperLimit(ticket({ clientOrderId: "timeout-1" }), j, {
    now,
    enabled: true,
    transport: { post: async () => { throw new Error("timeout"); } },
  });
  assert.equal(r.intentPersisted, true);
  assert.equal(j.isConsumed("timeout-1"), true);
  rmSync(dir, { recursive: true, force: true });
});

test("six stages and 13 agents remain represented", () => {
  assert.equal(architectureReadiness().length, 6);
  assert.equal(Object.keys(agentRoleStatus()).length, 13);
});
