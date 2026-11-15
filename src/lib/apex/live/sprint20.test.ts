import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluateAsset, marketSession, validateEquityQuote, EQUITY_CANDIDATES, worstCaseNotional } from "./equity.ts";
import { prepareEquityTicket, validateEquityTicket, identityMatches, proposedBrokerBody, type EquityTicket } from "./equity-adapter.ts";
import { HermesJournal, MockBroker } from "./journal.ts";
import { issueGateProof } from "./executor.ts";
import { CONNECTIVITY_TEST, STRATEGY_TRADE, agentRoleStatus } from "./connectivity.ts";
import { architectureReadiness } from "./architecture.ts";

const now = new Date("2026-11-16T15:00:00Z"); // Monday regular
const calendar: [] = [];

const ticket = (over: Partial<EquityTicket> = {}): EquityTicket => ({
  category: CONNECTIVITY_TEST,
  symbol: "SPY",
  side: "buy",
  orderType: "limit",
  timeInForce: "day",
  maxNotional: 10,
  qty: 0.01,
  limitPrice: 500,
  expiry: new Date(now.getTime() + 3600_000).toISOString(),
  singleUseId: "eq-1",
  readAuthorized: true,
  orderAuthorized: true,
  confirmed: true,
  session: "REGULAR",
  fractionable: true,
  ...over,
});

const quote = () => ({ bid: 500, ask: 500.05, timestamp: now.toISOString() });
const proofFor = (t: EquityTicket) => issueGateProof(
  { singleUseId: t.singleUseId, symbol: t.symbol, side: t.side, qty: t.qty, limitPrice: t.limitPrice },
  { dataIntegrityOk: true, riskOk: true, notional: t.maxNotional },
  now,
);

test("SPY eligibility evidence and candidate set", () => {
  assert.ok(EQUITY_CANDIDATES.includes("SPY"));
  const spy = evaluateAsset({ symbol: "SPY", tradable: true, fractionable: true, overnight_tradable: true, min_order_size: "1", min_trade_increment: "0.01" });
  assert.equal(spy.tradable, true);
  assert.equal(spy.blockers.length, 0);
  const bad = evaluateAsset({ symbol: "SPY", tradable: false });
  assert.ok(bad.blockers.includes("not tradable"));
});

test("market session: Sunday 8pm reopen, Friday close, weekend, holiday, shortened", () => {
  assert.equal(marketSession(new Date("2026-11-16T00:30:00Z")), "CLOSED");
  assert.equal(marketSession(new Date("2026-11-16T01:00:00Z")), "OVERNIGHT");
  assert.equal(marketSession(new Date("2026-11-15T23:00:00Z")), "CLOSED");
  assert.equal(marketSession(new Date("2026-11-21T01:00:00Z")), "CLOSED");
  assert.equal(marketSession(new Date("2026-11-20T08:00:00Z")), "OVERNIGHT");
  assert.equal(marketSession(new Date("2026-01-01T15:00:00Z")), "CLOSED");
  assert.equal(marketSession(now), "REGULAR");
  assert.equal(marketSession(new Date("2026-11-27T18:00:00Z"), [{ date: "2026-11-27", status: "SHORTENED", earlyCloseEt: "13:00" }]), "CLOSED");
});

test("equity quote validation enforces freshness and spread", () => {
  assert.equal(validateEquityQuote(quote(), now.getTime()).ok, true);
  const stale = { bid: 500, ask: 500.05, timestamp: new Date(now.getTime() - 60_000).toISOString() };
  assert.equal(validateEquityQuote(stale, now.getTime()).ok, false);
});

test("equity adapter refuses STRATEGY_TRADE, closed, market BUY, and requires proof", () => {
  const dir = mkdtempSync(join(tmpdir(), "eq-"));
  const j = new HermesJournal(join(dir, "j.json"));
  const strat = prepareEquityTicket(ticket({ category: STRATEGY_TRADE }), quote(), j, proofFor(ticket({ category: STRATEGY_TRADE })), { now, calendar });
  assert.ok(strat.reason.includes("CONNECTIVITY_TEST"));
  const closed = prepareEquityTicket(ticket({ session: "CLOSED" }), quote(), j, null, { now: new Date("2026-11-15T23:00:00Z"), calendar });
  assert.ok(closed.reason.includes("session") || closed.reason.includes("closed"));
  const mkt = prepareEquityTicket(ticket({ orderType: "market", limitPrice: null }), quote(), j, null, { now, calendar });
  assert.ok(mkt.reason.includes("limit"));
  const missing = prepareEquityTicket(ticket({ singleUseId: "no-gate" }), quote(), j, null, { now, calendar });
  assert.equal(missing.intentPersisted, false);
  assert.ok(missing.reason.includes("proof") || missing.reason.includes("Sigma"));
  const t = ticket({ singleUseId: "ok-1" });
  const ok = prepareEquityTicket(t, quote(), j, proofFor(t), { now, calendar });
  assert.equal(ok.enabled, false);
  assert.equal(ok.submitted, false);
  assert.equal(ok.intentPersisted, true);
  assert.equal(identityMatches(ok.identity!, proposedBrokerBody(ok.identity!, ok.clientOrderId!)), true);
  rmSync(dir, { recursive: true, force: true });
});

test("Sigma veto proof blocks equity ticket", () => {
  const dir = mkdtempSync(join(tmpdir(), "eq-"));
  const j = new HermesJournal(join(dir, "j.json"));
  const t = ticket({ singleUseId: "veto" });
  const sigma = issueGateProof(
    { singleUseId: t.singleUseId, symbol: t.symbol, side: t.side, qty: t.qty, limitPrice: t.limitPrice },
    { dataIntegrityOk: false, riskOk: true, notional: 10 },
    now,
  );
  const r = prepareEquityTicket(t, quote(), j, sigma, { now, calendar });
  assert.ok(r.reason.includes("Sigma"));
  assert.equal(r.intentPersisted, false);
  rmSync(dir, { recursive: true, force: true });
});

test("mock equity lifecycle with journal recovery and distinct exit auth", () => {
  const dir = mkdtempSync(join(tmpdir(), "eq-"));
  const path = join(dir, "j.json");
  const j = new HermesJournal(path);
  const broker = new MockBroker();
  const t = ticket({ singleUseId: "life-buy", qty: 0.02, limitPrice: 100, maxNotional: 10 });
  const buy = prepareEquityTicket(t, quote(), j, proofFor(t), { now, calendar });
  assert.equal(buy.intentPersisted, true);
  broker.submit(buy.clientOrderId!, "buy", 0.02, "SPY");
  broker.partialFill(buy.clientOrderId!, 0.01);
  assert.equal(broker.getPosition(), 0.01);
  broker.complete(buy.clientOrderId!);
  const sellT = ticket({ singleUseId: "life-sell", side: "sell", qty: 0.02 });
  const sell = prepareEquityTicket(sellT, quote(), j, null, { now, calendar, positions: { ownedQty: 0.02, openExitQty: 0 } });
  const sold = broker.submit(sell.clientOrderId!, "sell", 0.02, "SPY");
  assert.equal(sold.status, "filled");
  assert.equal(broker.getPosition(), 0);
  const j2 = new HermesJournal(path);
  assert.ok(j2.get(buy.clientOrderId!));
  assert.equal(j2.isConsumed("life-buy"), true);
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
  assert.ok(worstCaseNotional(0.1, 500, 10) > 25);
});
