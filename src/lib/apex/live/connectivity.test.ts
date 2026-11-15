import assert from "node:assert/strict";
import test from "node:test";
import { liveAccountPreflight, prepareLiveTicket, agentRoleStatus, assertLiveGetOnly, CONNECTIVITY_TEST, STRATEGY_TRADE } from "./connectivity.ts";

test("LIVE preflight is GET-only and refuses POST", () => {
  assert.throws(() => assertLiveGetOnly("https://api.alpaca.markets/v2/account", "POST"), /GET-only/);
  assert.throws(() => assertLiveGetOnly("https://paper-api.alpaca.markets/v2/account"), /not the live host/);
});

test("preflight without authorization returns blockers and canSubmit false", async () => {
  const transport = {
    async get() {
      throw new Error("should not be called");
    },
  };
  const r = await liveAccountPreflight(transport, { authorized: false, symbol: "BTC/USD", maxNotional: 10 });
  assert.equal(r.canSubmit, false);
  assert.equal(r.authorized, false);
  assert.ok(r.blockers.some((b) => b.includes("authorization")));
});

test("preflight with authorization still cannot submit", async () => {
  const transport = {
    async get(url: string) {
      if (url.includes("/account")) return { status: 200, body: { status: "ACTIVE", trading_blocked: false, cash: "1000" } };
      if (url.includes("/positions")) return { status: 200, body: [] };
      if (url.includes("/orders")) return { status: 200, body: [] };
      if (url.includes("/assets/")) return { status: 200, body: { tradable: true } };
      return { status: 404, body: {} };
    },
  };
  const r = await liveAccountPreflight(transport, { authorized: true, symbol: "BTC/USD", maxNotional: 10 });
  assert.equal(r.canSubmit, false);
  assert.equal(r.accountActive, true);
  assert.equal(r.instrumentTradable, true);
  assert.ok(r.blockers.length === 0 || r.blockers.every((b) => !b.includes("authorization")));
});

test("LIVE ticket executor is disabled by default and refuses STRATEGY_TRADE", () => {
  const disabled = prepareLiveTicket({
    symbol: "BTC/USD",
    side: "buy",
    orderType: "market",
    maxNotional: 10,
    authorizationExpiry: "2026-11-15T04:00:00Z",
    category: CONNECTIVITY_TEST,
    confirmed: true,
  });
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.submitted, false);
  assert.ok(disabled.reason.includes("disabled"));

  const strategy = prepareLiveTicket({
    symbol: "BTC/USD",
    side: "buy",
    orderType: "market",
    maxNotional: 10,
    authorizationExpiry: "2026-11-15T04:00:00Z",
    category: STRATEGY_TRADE,
    confirmed: true,
  });
  assert.equal(strategy.submitted, false);
  assert.ok(strategy.reason.includes("CONNECTIVITY_TEST"));
});

test("agent roles expose status without faking AI inference", () => {
  const roles = agentRoleStatus();
  assert.equal(roles.Bull.inference, false);
  assert.equal(roles.Bear.inference, false);
  assert.equal(roles.Bull.status, "BLOCKED");
  assert.equal(roles.Pilot.status, "BLOCKED");
  assert.equal(roles.Sigma.status, "ACTIVE");
  assert.equal(roles.Sentinel.status, "ACTIVE");
  assert.ok(Object.keys(roles).length === 13);
});

test("hard max notional is enforced", () => {
  const over = prepareLiveTicket({
    symbol: "BTC/USD",
    side: "buy",
    orderType: "market",
    maxNotional: 100,
    authorizationExpiry: "2026-11-15T04:00:00Z",
    category: CONNECTIVITY_TEST,
    confirmed: true,
  });
  assert.equal(over.submitted, false);
  assert.ok(over.reason.includes("25"));
});
