import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluateAsset, marketSession, validateEquityQuote, EQUITY_CANDIDATES, worstCaseNotional } from "./equity.ts";
import { prepareEquityTicket, validateEquityTicket, identityMatches, proposedBrokerBody, type EquityTicket } from "./equity-adapter.ts";
import { HermesJournal, MockBroker } from "./journal.ts";
import { evaluateGates } from "./executor.ts";
import { CONNECTIVITY_TEST, STRATEGY_TRADE, agentRoleStatus } from "./connectivity.ts";
import { architectureReadiness } from "./architecture.ts";

const approved = evaluateGates({ dataIntegrityOk: true, riskOk: true, notional: 10 });

const ticket = (over: Partial<EquityTicket> = {}): EquityTicket => ({
  category: CONNECTIVITY_TEST,
  symbol: "SPY",
  side: "buy",
  orderType: "limit",
  timeInForce: "day",
  maxNotional: 10,
  qty: 0.01,
  limitPrice: 500,
  expiry: new Date(Date.now() + 3600_000).toISOString(),
  singleUseId: "eq-1",
  readAuthorized: true,
  orderAuthorized: true,
  confirmed: true,
  session: "REGULAR",
  fractionable: true,
  ...over,
});

const quote = () => ({ bid: 500, ask: 500.05, timestamp: new Date().toISOString() });

test("SPY eligibility evidence and candidate set", () => {
  assert.ok(EQUITY_CANDIDATES.includes("SPY"));
  const spy = evaluateAsset({ symbol: "SPY", tradable: true, fractionable: true, overnight_tradable: true, min_order_size: "1", min_trade_increment: "0.01" });
  assert.equal(spy.tradable, true);
  assert.equal(spy.fractionable, true);
  assert.equal(spy.blockers.length, 0);
  const bad = evaluateAsset({ symbol: "SPY", tradable: false });
  assert.ok(bad.blockers.includes("not tradable"));
  assert.ok(bad.blockers.includes("minimum ambiguous"));
});

test("market session: Sunday 8pm reopen, Friday close, weekend, holiday, shortened", () => {
  assert.equal(marketSession(new Date("2026-11-15T00:00:00Z")), "CLOSED"); // Sat evening prior? check ET
  assert.equal(marketSession(new Date("2026-11-16T00:30:00Z")), "CLOSED"); // Sun 19:30 ET, before 20:00 reopen
  // Sunday 2026-11-15 20:00 ET = 2026-11-16 01:00 UTC (EST)
  assert.equal(marketSession(new Date("2026-11-16T01:00:00Z")), "OVERNIGHT");
  assert.equal(marketSession(new Date("2026-11-15T23:00:00Z")), "CLOSED"); // Sun 18:00 ET
  // Friday 2026-11-20 20:00 ET = 2026-11-21 01:00 UTC
  assert.equal(marketSession(new Date("2026-11-21T01:00:00Z")), "CLOSED");
  assert.equal(marketSession(new Date("2026-11-20T08:00:00Z")), "OVERNIGHT"); // Fri 03:00 ET
  assert.equal(marketSession(new Date("2026-01-01T15:00:00Z")), "CLOSED");
  assert.equal(marketSession(new Date("2026-11-16T15:00:00Z")), "REGULAR");
  assert.equal(marketSession(new Date("2026-11-27T18:00:00Z"), [{ date: "2026-11-27", status: "SHORTENED", earlyCloseEt: "13:00" }]), "CLOSED");
});

test("equity quote validation enforces freshness and spread", () => {
  assert.equal(validateEquityQuote(quote()).ok, true);
  const stale = { bid: 500, ask: 500.05, timestamp: new Date(Date.now() - 60_000).toISOString() };
  assert.equal(validateEquityQuote(stale).ok, false);
  const wide = { bid: 500, ask: 510, timestamp: new Date().toISOString() };
  assert.equal(validateEquityQuote(wide).ok, false);
});

test("equity adapter refuses STRATEGY_TRADE, closed, overnight market, and requires gates", () => {
  const dir = mkdtempSync(join(tmpdir(), "eq-"));
  const j = new HermesJournal(join(dir, "j.json"));
  const strat = prepareEquityTicket(ticket({ category: STRATEGY_TRADE }), quote(), j, approved);
  assert.equal(strat.submitted, false);
  assert.ok(strat.reason.includes("CONNECTIVITY_TEST"));
  assert.equal(strat.intentPersisted, false);

  const closed = prepareEquityTicket(ticket({ session: "CLOSED" }), quote(), j, approved);
  assert.ok(closed.reason.includes("closed"));

  const ovn = prepareEquityTicket(ticket({ session: "OVERNIGHT", orderType: "market", limitPrice: null }), quote(), j, approved);
  assert.ok(ovn.reason.includes("limit"));

  const missing = prepareEquityTicket(ticket({ singleUseId: "no-gate" }), quote(), j, null);
  assert.equal(missing.intentPersisted, false);
  assert.ok(missing.reason.includes("Sigma") || missing.reason.includes("approval"));

  const ok = prepareEquityTicket(ticket({ singleUseId: "ok-1" }), quote(), j, approved);
  assert.equal(ok.enabled, false);
  assert.equal(ok.submitted, false);
  assert.equal(ok.intentPersisted, true);
  assert.ok(ok.clientOrderId);
  assert.ok(ok.identity);
  const proposed = proposedBrokerBody(ok.identity!, ok.clientOrderId!);
  assert.equal(identityMatches(ok.identity!, proposed), true);
  rmSync(dir, { recursive: true, force: true });
});

test("Sigma and Sentinel vetoes block equity ticket", () => {
  const dir = mkdtempSync(join(tmpdir(), "eq-"));
  const j = new HermesJournal(join(dir, "j.json"));
  const sigma = evaluateGates({ dataIntegrityOk: false, riskOk: true, notional: 10 });
  const r = prepareEquityTicket(ticket({ singleUseId: "veto" }), quote(), j, sigma);
  assert.equal(r.submitted, false);
  assert.ok(r.reason.includes("Sigma"));
  assert.equal(r.intentPersisted, false);
  rmSync(dir, { recursive: true, force: true });
});

test("mock equity lifecycle: BUY partial → complete → SELL → flat, with journal recovery", () => {
  const dir = mkdtempSync(join(tmpdir(), "eq-"));
  const path = join(dir, "j.json");
  const j = new HermesJournal(path);
  const broker = new MockBroker();
  const buy = prepareEquityTicket(ticket({ singleUseId: "life-buy", qty: 0.02, limitPrice: 100, maxNotional: 10 }), quote(), j, approved);
  assert.equal(buy.intentPersisted, true);
  const filled = broker.submit(buy.clientOrderId!, "buy", 0.02, "SPY");
  broker.partialFill(buy.clientOrderId!, 0.01);
  assert.equal(broker.getPosition(), 0.01);
  broker.complete(buy.clientOrderId!);
  assert.equal(broker.getPosition(), 0.02);
  j.reconcileByClientOrderId(buy.clientOrderId!, "filled", 0.02);
  const sell = prepareEquityTicket(ticket({ singleUseId: "life-sell", side: "sell", qty: 0.02 }), quote(), j, null);
  const sold = broker.submit(sell.clientOrderId!, "sell", 0.02, "SPY");
  assert.equal(sold.status, "filled");
  assert.equal(broker.getPosition(), 0);
  assert.equal(broker.openOrders(), 0);
  const j2 = new HermesJournal(path);
  assert.ok(j2.get(buy.clientOrderId!));
  rmSync(dir, { recursive: true, force: true });
});

test("13 agents and six stages preserved", () => {
  assert.equal(Object.keys(agentRoleStatus()).length, 13);
  assert.equal(architectureReadiness().length, 6);
  assert.equal(agentRoleStatus().Bull.inference, false);
});

test("validateEquityTicket enforces notional and limit", () => {
  assert.ok(validateEquityTicket(ticket({ maxNotional: 100 }))?.includes("25"));
  assert.ok(validateEquityTicket(ticket({ orderType: "limit", limitPrice: null }))?.includes("limit"));
});
