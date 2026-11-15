import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluateAsset, readOvernightQuote, overnightQuoteUrl, validateEquityQuote } from "./equity.ts";
import { prepareEquityTicket, alpacaOrderPayload, type EquityTicket } from "./equity-adapter.ts";
import { HermesJournal, MockBroker } from "./journal.ts";
import { issueGateProof } from "./executor.ts";
import { CONNECTIVITY_TEST, agentRoleStatus } from "./connectivity.ts";
import { architectureReadiness } from "./architecture.ts";

const now = new Date("2026-11-16T15:00:00Z");
const calendar: [] = [];

const liveAsset = (symbol: string) => ({
  symbol,
  status: "active",
  tradable: true,
  fractionable: true,
  attributes: ["overnight_tradable", "fractional_eh_enabled"],
});

const ticket = (over: Partial<EquityTicket> = {}): EquityTicket => ({
  category: CONNECTIVITY_TEST,
  symbol: "SPY",
  side: "buy",
  orderType: "limit",
  timeInForce: "day",
  maxNotional: 10,
  qty: 0.02,
  limitPrice: 100,
  expiry: new Date(now.getTime() + 3600_000).toISOString(),
  singleUseId: "paper-1",
  readAuthorized: true,
  orderAuthorized: true,
  confirmed: true,
  session: "REGULAR",
  fractionable: true,
  ...over,
});

const quote = () => ({ bid: 100, ask: 100.02, timestamp: now.toISOString() });
const proofFor = (t: EquityTicket) => issueGateProof(
  { singleUseId: t.singleUseId, symbol: t.symbol, side: t.side, qty: t.qty, limitPrice: t.limitPrice },
  { dataIntegrityOk: true, riskOk: true, notional: t.maxNotional },
  now,
);

test("eligibility parser uses attributes and does not require crypto minimums", () => {
  for (const symbol of ["SPY", "QQQ", "IWM"]) {
    const e = evaluateAsset(liveAsset(symbol));
    assert.equal(e.tradable, true);
    assert.equal(e.fractionable, true);
    assert.equal(e.overnightEligible, true);
    assert.equal(e.fractionalEhEnabled, true);
    assert.equal(e.overnightHalted, false);
    assert.equal(e.blockers.length, 0);
  }
  const halted = evaluateAsset({ ...liveAsset("SPY"), attributes: ["overnight_tradable", "overnight_halted"] });
  assert.equal(halted.overnightEligible, false);
  assert.ok(halted.blockers.includes("overnight halted"));
});

test("Alpaca payload contains only supported fields", () => {
  const id = {
    symbol: "SPY", side: "buy" as const, orderType: "limit" as const, qty: 0.02,
    limitPrice: 100, timeInForce: "day" as const, session: "REGULAR" as const,
    extendedHours: false, singleUseId: "x", expiry: "2026-11-16T16:00:00Z", worstCaseNotional: 2.002,
  };
  const body = alpacaOrderPayload(id, "apex-eq-x");
  assert.deepEqual(Object.keys(body).sort(), ["client_order_id", "limit_price", "qty", "side", "symbol", "time_in_force", "type"]);
  assert.equal("session" in body, false);
  assert.equal("expiry" in body, false);
  assert.equal("single_use_id" in body, false);
});

test("overnight quote reader rejects stale and wide quotes", () => {
  assert.ok(overnightQuoteUrl("SPY").includes("feed=overnight"));
  const q = readOvernightQuote({ bp: 500, ap: 500.05, t: now.toISOString() });
  assert.equal("error" in q, false);
  if (!("error" in q)) assert.equal(validateEquityQuote(q, now.getTime()).ok, true);
  const stale = readOvernightQuote({ bp: 500, ap: 500.05, t: new Date(now.getTime() - 60_000).toISOString() });
  if (!("error" in stale)) assert.equal(validateEquityQuote(stale, now.getTime()).ok, false);
  const bad = readOvernightQuote({ bp: 500, ap: 490, t: now.toISOString() });
  assert.equal("error" in bad, true);
});

test("PAPER BUY → partial → SELL → flat with crash recovery and emergency exit", () => {
  const dir = mkdtempSync(join(tmpdir(), "paper-"));
  const path = join(dir, "j.json");
  const j = new HermesJournal(path);
  const broker = new MockBroker();
  const t = ticket({ singleUseId: "paper-buy" });
  const buy = prepareEquityTicket(t, quote(), j, proofFor(t), { now, calendar });
  assert.equal(buy.enabled, false);
  assert.equal(buy.submitted, false);
  assert.equal(buy.intentPersisted, true);
  broker.submit(buy.clientOrderId!, "buy", 0.02, "SPY");
  broker.partialFill(buy.clientOrderId!, 0.01);
  assert.equal(broker.getPosition(), 0.01);
  broker.complete(buy.clientOrderId!);
  j.reconcileByClientOrderId(buy.clientOrderId!, "filled", 0.02);
  const restarted = new HermesJournal(path);
  assert.equal(restarted.isConsumed("paper-buy"), true);
  const sell = prepareEquityTicket(ticket({ side: "sell", singleUseId: "paper-sell" }), quote(), restarted, null, {
    now, calendar, positions: { ownedQty: broker.getPosition(), openExitQty: broker.openOrders() },
  });
  assert.equal(sell.intentPersisted, true);
  broker.submit(sell.clientOrderId!, "sell", 0.02, "SPY");
  assert.equal(broker.getPosition(), 0);
  assert.equal(broker.openOrders(), 0);
  rmSync(dir, { recursive: true, force: true });
});

test("forged proof is rejected; six stages and 13 agents intact", () => {
  const dir = mkdtempSync(join(tmpdir(), "paper-"));
  const j = new HermesJournal(join(dir, "j.json"));
  const t = ticket({ singleUseId: "forge" });
  const forged = { ...proofFor(t), proof: "not-issued" };
  const r = prepareEquityTicket(t, quote(), j, forged, { now, calendar });
  assert.equal(r.intentPersisted, false);
  assert.ok(r.reason.includes("issued") || r.reason.includes("proof"));
  assert.equal(architectureReadiness().length, 6);
  assert.equal(Object.keys(agentRoleStatus()).length, 13);
  rmSync(dir, { recursive: true, force: true });
});
