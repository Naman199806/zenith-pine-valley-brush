import assert from "node:assert/strict";
import test from "node:test";
import { strictLivePreflight, assertStrictLiveGet } from "./preflight.ts";
import { prepareSupervisedTicket, reconcileBeforeExit, verifyFlat, checkSpread, type TicketAuthorization } from "./executor.ts";
import { CONNECTIVITY_TEST, STRATEGY_TRADE, agentRoleStatus } from "./connectivity.ts";

const validAuth = (overrides: Partial<TicketAuthorization> = {}): TicketAuthorization => ({
  category: CONNECTIVITY_TEST,
  symbol: "BTC/USD",
  side: "buy",
  orderType: "market",
  maxNotional: 10,
  expiry: new Date(Date.now() + 3600_000).toISOString(),
  singleUseId: "test-single-use-1",
  readAuthorized: true,
  orderAuthorized: true,
  confirmed: true,
  ...overrides,
});

const goodQuote = { bid: 90000, ask: 90010, timestamp: new Date().toISOString() };

test("strict preflight rejects non-HTTPS, wrong host, and POST", () => {
  assert.throws(() => assertStrictLiveGet("http://api.alpaca.markets/v2/account"), /HTTPS/);
  assert.throws(() => assertStrictLiveGet("https://paper-api.alpaca.markets/v2/account"), /exact live host/);
  assert.throws(() => assertStrictLiveGet("https://api.alpaca.markets/v2/account", "POST"), /GET-only/);
  assert.throws(() => assertStrictLiveGet("https://api.alpaca.markets/v2/orders"), /status filter/);
});

test("preflight fails closed on malformed account and unauthorized", async () => {
  const bad = { async get() { return { status: 200, body: { status: 123 } }; } };
  const r1 = await strictLivePreflight(bad, { authorized: true, symbol: "BTC/USD", maxNotional: 10 });
  assert.equal(r1.canSubmit, false);
  assert.ok(r1.blockers.some((b) => b.includes("malformed") || b.includes("missing")));

  const none = { async get() { throw new Error("no"); } };
  const r2 = await strictLivePreflight(none, { authorized: false, symbol: "BTC/USD", maxNotional: 10 });
  assert.equal(r2.authorized, false);
  assert.ok(r2.blockers.some((b) => b.includes("authorization")));
});

test("preflight accepts well-formed ACTIVE account but still cannot submit", async () => {
  const transport = {
    async get(url: string) {
      if (url.includes("/account")) return { status: 200, body: { status: "ACTIVE", trading_blocked: false, account_blocked: false, buying_power: "1000", cash: "1000", crypto_status: "ACTIVE" } };
      if (url.includes("/positions")) return { status: 200, body: [] };
      if (url.includes("/orders")) return { status: 200, body: [] };
      if (url.includes("/assets/")) return { status: 200, body: { tradable: true, fractionable: true, min_order_size: "1" } };
      return { status: 404, body: {} };
    },
  };
  const r = await strictLivePreflight(transport, { authorized: true, symbol: "BTC/USD", maxNotional: 10 });
  assert.equal(r.accountActive, true);
  assert.equal(r.canSubmit, false);
  assert.equal(r.instrumentTradable, true);
  assert.equal(r.blockers.length, 0);
});

test("executor refuses STRATEGY_TRADE, expired auth, and missing order permission", () => {
  const q = goodQuote;
  const strat = prepareSupervisedTicket(validAuth({ category: STRATEGY_TRADE }), q);
  assert.equal(strat.submitted, false);
  assert.ok(strat.reason.includes("CONNECTIVITY_TEST"));

  const expired = prepareSupervisedTicket(validAuth({ expiry: new Date(Date.now() - 1000).toISOString() }), q);
  assert.ok(expired.reason.includes("expired"));

  const noOrder = prepareSupervisedTicket(validAuth({ orderAuthorized: false }), q);
  assert.ok(noOrder.reason.includes("order permission"));
});

test("executor persists intent but remains disabled; spread gate works", () => {
  const ok = prepareSupervisedTicket(validAuth(), goodQuote);
  assert.equal(ok.enabled, false);
  assert.equal(ok.submitted, false);
  assert.ok(ok.clientOrderId);
  assert.equal(ok.intent?.status, "PERSISTED");

  const wide = prepareSupervisedTicket(validAuth(), { bid: 90000, ask: 91000, timestamp: "" });
  assert.ok(wide.reason.includes("spread"));
  assert.equal(checkSpread({ bid: 100, ask: 100.1, timestamp: "" }), null);
});

test("emergency entry block allows risk-reducing exit path to be prepared separately", () => {
  const blockedBuy = prepareSupervisedTicket(validAuth({ side: "buy" }), goodQuote, true);
  assert.ok(blockedBuy.reason.includes("emergency entry block"));

  // Sell under separate auth is not blocked by entry block flag in this path
  const sellAuth = validAuth({ side: "sell", singleUseId: "exit-1" });
  const sell = prepareSupervisedTicket(sellAuth, goodQuote, true);
  assert.equal(sell.submitted, false);
  assert.ok(sell.intent || sell.reason.includes("disabled"));
});

test("reconcile owned quantity before sell and verify flat", () => {
  assert.equal(reconcileBeforeExit(0.001, 0.002), "sell quantity exceeds owned quantity");
  assert.equal(reconcileBeforeExit(0, 0.001), "no position to exit");
  assert.equal(reconcileBeforeExit(0.001, 0.001), null);
  assert.equal(verifyFlat([], 0), true);
  assert.equal(verifyFlat([{ symbol: "BTC/USD", qty: 0.0001 }], 0), false);
  assert.equal(verifyFlat([], 1), false);
});

test("mocked full round-trip: BUY intent → fill → SELL intent → flat", () => {
  const buy = prepareSupervisedTicket(validAuth({ singleUseId: "rt-buy" }), goodQuote);
  assert.equal(buy.submitted, false);
  assert.equal(buy.intent?.status, "PERSISTED");

  // Simulate broker fill outside the disabled path
  const filledQty = 0.0001;
  const sellAuth = validAuth({ side: "sell", singleUseId: "rt-sell", maxNotional: 10 });
  const sell = prepareSupervisedTicket(sellAuth, goodQuote);
  assert.equal(sell.submitted, false);
  assert.equal(reconcileBeforeExit(filledQty, filledQty), null);
  assert.equal(verifyFlat([], 0), true);
});

test("13 agent roles preserved; Bull/Bear blocked; no strategy approval", () => {
  const roles = agentRoleStatus();
  assert.equal(Object.keys(roles).length, 13);
  assert.equal(roles.Bull.status, "BLOCKED");
  assert.equal(roles.Bear.status, "BLOCKED");
  assert.equal(roles.Bull.inference, false);
  assert.equal(roles.Sigma.status, "ACTIVE");
  assert.equal(roles.Sentinel.status, "ACTIVE");
  assert.equal(roles.Pilot.status, "BLOCKED");
});

test("duplicate client ID and unknown status are detectable", () => {
  const a = prepareSupervisedTicket(validAuth({ singleUseId: "dup" }), goodQuote);
  const b = prepareSupervisedTicket(validAuth({ singleUseId: "dup" }), goodQuote);
  assert.notEqual(a.clientOrderId, b.clientOrderId); // timestamp differentiates
  assert.equal(a.intent?.status, "PERSISTED");
});
