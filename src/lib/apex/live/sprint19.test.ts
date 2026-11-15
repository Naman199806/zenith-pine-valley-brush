import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HermesJournal, MockBroker } from "./journal.ts";
import { prepareSupervisedTicket, evaluateGates, checkQuoteFreshness, type TicketAuthorization } from "./executor.ts";
import { strictLivePreflight } from "./preflight.ts";
import { CONNECTIVITY_TEST, agentRoleStatus } from "./connectivity.ts";
import { architectureReadiness } from "./architecture.ts";

const auth = (id: string): TicketAuthorization => ({
  category: CONNECTIVITY_TEST,
  symbol: "BTC/USD",
  side: "buy",
  orderType: "market",
  maxNotional: 10,
  expiry: new Date(Date.now() + 3600_000).toISOString(),
  singleUseId: id,
  readAuthorized: true,
  orderAuthorized: true,
  confirmed: true,
});

const freshQuote = () => ({ bid: 90000, ask: 90020, timestamp: new Date().toISOString() });
const approved = evaluateGates({ dataIntegrityOk: true, riskOk: true, notional: 10 });

test("persistent journal survives fresh process restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "hermes-"));
  const path = join(dir, "journal.json");
  const j1 = new HermesJournal(path);
  const intent = prepareSupervisedTicket(auth("persist-1"), freshQuote(), false, approved).intent!;
  j1.persist(intent);
  j1.consumeAuthorization("persist-1");
  j1.updateStatus(intent.clientOrderId, "UNKNOWN", 0, null, "timeout");

  const j2 = new HermesJournal(path);
  assert.equal(j2.isConsumed("persist-1"), true);
  assert.equal(j2.get(intent.clientOrderId)?.status, "UNKNOWN");
  assert.throws(() => j2.consumeAuthorization("persist-1"), /already consumed/);
  const rec = j2.reconcileByClientOrderId(intent.clientOrderId, "filled", 0.0001);
  assert.equal(rec.status, "FILLED");
  assert.ok(rec.recoveryNotes.some((n) => n.includes("no resubmit")));
  rmSync(dir, { recursive: true, force: true });
});

test("unknown recovery queries by client-order ID and never resubmits", () => {
  const dir = mkdtempSync(join(tmpdir(), "hermes-"));
  const j = new HermesJournal(join(dir, "j.json"));
  const broker = new MockBroker();
  const intent = prepareSupervisedTicket(auth("unk-1"), freshQuote(), false, approved).intent!;
  j.persist(intent);
  broker.disconnectNext = true;
  assert.throws(() => broker.submit(intent.clientOrderId, "buy", 0.0001, "BTC/USD"), /disconnect/);
  const looked = broker.lookupByClientOrderId(intent.clientOrderId);
  assert.equal(looked, undefined);
  const after = broker.submit(intent.clientOrderId, "buy", 0.0001, "BTC/USD");
  const rec = j.reconcileByClientOrderId(intent.clientOrderId, after.status, after.filledQty);
  assert.equal(rec.status, "FILLED");
  assert.ok(rec.recoveryNotes.at(-1)?.includes("no resubmit"));
  rmSync(dir, { recursive: true, force: true });
});

test("mock partial-fill lifecycle accounts quantity correctly", () => {
  const broker = new MockBroker();
  const buy = broker.submit("p-buy", "buy", 0.0002, "BTC/USD");
  assert.equal(buy.status, "filled");
  broker.partialFill("p-buy", 0.0001);
  assert.equal(broker.getPosition(), 0.0001);
  assert.equal(broker.openOrders(), 1);
  broker.complete("p-buy");
  assert.equal(broker.getPosition(), 0.0002);
  assert.equal(broker.openOrders(), 0);
  const sell = broker.submit("p-sell", "sell", 0.0002, "BTC/USD");
  assert.equal(sell.status, "filled");
  assert.equal(broker.getPosition(), 0);
});

test("preflight fails closed on missing account_blocked, invalid values, malformed orders, ambiguous min", async () => {
  const missingBlock = {
    async get(url: string) {
      if (url.includes("/account")) return { status: 200, body: { status: "ACTIVE", trading_blocked: false, buying_power: "1000", cash: "1000", crypto_status: "ACTIVE" } };
      return { status: 200, body: [] };
    },
  };
  const r1 = await strictLivePreflight(missingBlock, { authorized: true, symbol: "BTC/USD", maxNotional: 10 });
  assert.ok(r1.blockers.some((b) => b.includes("account_blocked") || b.includes("failed")));

  const badOrder = {
    async get(url: string) {
      if (url.includes("/account")) return { status: 200, body: { status: "ACTIVE", trading_blocked: false, account_blocked: false, buying_power: "1000", cash: "1000", crypto_status: "ACTIVE" } };
      if (url.includes("/positions")) return { status: 200, body: [] };
      if (url.includes("/orders")) return { status: 200, body: [{ noid: true }] };
      return { status: 200, body: { tradable: true, min_order_size: "1" } };
    },
  };
  const r2 = await strictLivePreflight(badOrder, { authorized: true, symbol: "BTC/USD", maxNotional: 10 });
  assert.ok(r2.blockers.some((b) => b.includes("order record") || b.includes("failed")));

  const ambMin = {
    async get(url: string) {
      if (url.includes("/account")) return { status: 200, body: { status: "ACTIVE", trading_blocked: false, account_blocked: false, buying_power: "1000", cash: "1000", crypto_status: "ACTIVE" } };
      if (url.includes("/positions")) return { status: 200, body: [] };
      if (url.includes("/orders")) return { status: 200, body: [] };
      return { status: 200, body: { tradable: true } };
    },
  };
  const r3 = await strictLivePreflight(ambMin, { authorized: true, symbol: "BTC/USD", maxNotional: 10 });
  assert.ok(r3.blockers.some((b) => b.includes("minimum") || b.includes("failed")));
});

test("quote freshness and gate vetoes cannot be bypassed", () => {
  const stale = { bid: 90000, ask: 90020, timestamp: new Date(Date.now() - 60_000).toISOString() };
  const r = prepareSupervisedTicket(auth("fresh"), stale, false, approved);
  assert.equal(r.submitted, false);
  assert.ok(r.reason.includes("stale"));

  const sigma = evaluateGates({ dataIntegrityOk: false, riskOk: true, notional: 10 });
  const blocked = prepareSupervisedTicket(auth("sig"), freshQuote(), false, sigma);
  assert.equal(blocked.submitted, false);
  assert.ok(blocked.reason.includes("Sigma"));

  const sentinel = evaluateGates({ dataIntegrityOk: true, riskOk: false, notional: 10 });
  const blocked2 = prepareSupervisedTicket(auth("sen"), freshQuote(), false, sentinel);
  assert.ok(blocked2.reason.includes("Sentinel"));
});

test("six stages and 13 agents remain intact", () => {
  const stages = architectureReadiness();
  assert.equal(stages.length, 6);
  const roles = agentRoleStatus();
  assert.equal(Object.keys(roles).length, 13);
  assert.equal(roles.Bull.status, "BLOCKED");
  assert.equal(roles.Bear.status, "BLOCKED");
  assert.equal(roles.Sigma.status, "ACTIVE");
  assert.equal(roles.Sentinel.status, "ACTIVE");
});
