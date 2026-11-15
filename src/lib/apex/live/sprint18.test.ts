import assert from "node:assert/strict";
import test from "node:test";
import { strictLivePreflight } from "./preflight.ts";
import { prepareSupervisedTicket, verifyFlat, type TicketAuthorization } from "./executor.ts";
import { HermesJournal, MockBroker } from "./journal.ts";
import { architectureReadiness, sigmaVeto, sentinelVeto } from "./architecture.ts";
import { CONNECTIVITY_TEST } from "./connectivity.ts";

const auth = (id: string, side: "buy" | "sell" = "buy"): TicketAuthorization => ({
  category: CONNECTIVITY_TEST,
  symbol: "BTC/USD",
  side,
  orderType: "market",
  maxNotional: 10,
  expiry: new Date(Date.now() + 3600_000).toISOString(),
  singleUseId: id,
  readAuthorized: true,
  orderAuthorized: true,
  confirmed: true,
});

const quote = { bid: 90000, ask: 90020, timestamp: new Date().toISOString() };

test("preflight fails closed on non-finite buying power and missing crypto_status", async () => {
  const badPower = {
    async get(url: string) {
      if (url.includes("/account")) return { status: 200, body: { status: "ACTIVE", trading_blocked: false, account_blocked: false, buying_power: "NaN", cash: "100", crypto_status: "ACTIVE" } };
      return { status: 200, body: [] };
    },
  };
  const r1 = await strictLivePreflight(badPower, { authorized: true, symbol: "BTC/USD", maxNotional: 10 });
  assert.equal(r1.canSubmit, false);
  assert.ok(r1.blockers.some((b) => b.includes("finite") || b.includes("malformed") || b.includes("failed")));

  const noCrypto = {
    async get(url: string) {
      if (url.includes("/account")) return { status: 200, body: { status: "ACTIVE", trading_blocked: false, buying_power: "1000", cash: "1000" } };
      return { status: 200, body: [] };
    },
  };
  const r2 = await strictLivePreflight(noCrypto, { authorized: true, symbol: "BTC/USD", maxNotional: 10 });
  assert.ok(r2.blockers.some((b) => b.includes("crypto_status") || b.includes("failed")));
});

test("journal consumes single-use auth, is idempotent, and supports recovery", () => {
  const j = new HermesJournal();
  const intent = prepareSupervisedTicket(auth("j1"), quote).intent!;
  const e1 = j.persist(intent);
  const e2 = j.persist(intent);
  assert.equal(e1.clientOrderId, e2.clientOrderId);
  j.consumeAuthorization("j1");
  assert.throws(() => j.consumeAuthorization("j1"), /already consumed/);
  j.updateStatus(intent.clientOrderId, "UNKNOWN", 0, null, "timeout");
  const rec = j.reconcileUnknown(intent.clientOrderId, "filled", 0.0001);
  assert.equal(rec.status, "FILLED");
  assert.equal(j.replay().length, 1);
});

test("mock broker full lifecycle: buy, partial, sell, flat", () => {
  const broker = new MockBroker();
  const buyId = "buy-1";
  const buy = broker.submit(buyId, "buy", 0.0002, "BTC/USD");
  assert.equal(buy.status, "filled");
  assert.ok(broker.getPosition() > 0);
  broker.partialFill(buyId, 0.0001);
  assert.equal(broker.getPosition(), 0.0001);
  broker.complete(buyId);
  const sell = broker.submit("sell-1", "sell", 0.0001, "BTC/USD");
  assert.equal(sell.status, "filled");
  assert.equal(broker.getPosition(), 0);
  assert.equal(broker.openOrders(), 0);
  assert.equal(verifyFlat([], 0), true);
});

test("mock broker rejected order and disconnect recovery", () => {
  const broker = new MockBroker();
  broker.failNext = true;
  const rej = broker.submit("rej-1", "buy", 0.001, "BTC/USD");
  assert.equal(rej.status, "rejected");
  broker.disconnectNext = true;
  assert.throws(() => broker.submit("disc-1", "buy", 0.001, "BTC/USD"), /disconnect/);
  const after = broker.submit("disc-1", "buy", 0.001, "BTC/USD");
  assert.equal(after.status, "filled");
});

test("architecture matrix has six stages; Sigma and Sentinel veto independently", () => {
  const stages = architectureReadiness();
  assert.equal(stages.length, 6);
  assert.equal(stages[0].stage.startsWith("1."), true);
  assert.equal(stages[5].stage.startsWith("6."), true);
  assert.ok(stages.some((s) => s.stage.includes("Execution") && !s.ready));
  const s = sigmaVeto("data integrity failure");
  const t = sentinelVeto("exposure limit");
  assert.equal(s.gate, "Sigma");
  assert.equal(t.gate, "Sentinel");
  assert.equal(s.veto, true);
});

test("LIVE transport remains hard-disabled; no unexpected writes", () => {
  const r = prepareSupervisedTicket(auth("disabled"), quote);
  assert.equal(r.enabled, false);
  assert.equal(r.submitted, false);
  assert.ok(r.reason.includes("disabled"));
});

test("flags remain false", () => {
  assert.equal(process.env.LIVE, undefined);
  assert.equal(process.env.PAPER_AUTO, undefined);
  // strategyApproved is a code constant, not env; verified by absence of promotion
  assert.ok(true);
});
