import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { worstCaseNotional, marketSession } from "./equity.ts";
import { prepareEquityTicket, validateEquityTicket, identityMatches, proposedBrokerBody, type EquityTicket } from "./equity-adapter.ts";
import { HermesJournal } from "./journal.ts";
import { evaluateGates } from "./executor.ts";
import { CONNECTIVITY_TEST } from "./connectivity.ts";

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
  singleUseId: "adv-1",
  readAuthorized: true,
  orderAuthorized: true,
  confirmed: true,
  session: "REGULAR",
  fractionable: true,
  ...over,
});

const quote = () => ({ bid: 500, ask: 500.02, timestamp: new Date().toISOString() });

test("worst-case notional rejects qty × limit exceeding approved cap", () => {
  const worst = worstCaseNotional(0.1, 500, 10);
  assert.ok(worst > 25);
  const r = validateEquityTicket(ticket({ qty: 0.1, limitPrice: 500, maxNotional: 25 }));
  assert.ok(r && r.includes("worst-case"));
  const ok = validateEquityTicket(ticket({ qty: 0.01, limitPrice: 500, maxNotional: 10 }));
  assert.equal(ok, null);
});

test("missing gate evidence blocks entry persistence", () => {
  const dir = mkdtempSync(join(tmpdir(), "adv-"));
  const j = new HermesJournal(join(dir, "j.json"));
  const r = prepareEquityTicket(ticket(), quote(), j, null);
  assert.equal(r.intentPersisted, false);
  assert.ok(r.reason.includes("Sigma") || r.reason.includes("approval"));
  const veto = evaluateGates({ dataIntegrityOk: true, riskOk: false, notional: 10 });
  const r2 = prepareEquityTicket(ticket({ singleUseId: "sen" }), quote(), j, veto);
  assert.equal(r2.intentPersisted, false);
  assert.ok(r2.reason.includes("Sentinel"));
  rmSync(dir, { recursive: true, force: true });
});

test("persisted identity matches proposed broker order", () => {
  const dir = mkdtempSync(join(tmpdir(), "adv-"));
  const j = new HermesJournal(join(dir, "j.json"));
  const r = prepareEquityTicket(ticket({ session: "EXTENDED", orderType: "limit" }), quote(), j, approved);
  assert.equal(r.intentPersisted, true);
  assert.equal(r.identity?.extendedHours, true);
  const proposed = proposedBrokerBody(r.identity!, r.clientOrderId!);
  assert.equal(identityMatches(r.identity!, proposed), true);
  const stored = j.get(r.clientOrderId!)?.equityIdentity;
  assert.equal(stored?.symbol, "SPY");
  assert.equal(stored?.timeInForce, "day");
  assert.equal(stored?.session, "EXTENDED");
  assert.equal(stored?.singleUseId, "adv-1");
  rmSync(dir, { recursive: true, force: true });
});

test("Alpaca rejects fractional gtc and overnight market", () => {
  assert.ok(validateEquityTicket(ticket({ qty: 0.5, timeInForce: "gtc" }))?.includes("fractional"));
  assert.ok(validateEquityTicket(ticket({ session: "OVERNIGHT", orderType: "market", limitPrice: 100 }))?.includes("limit"));
  assert.ok(validateEquityTicket(ticket({ qty: 1, session: "OVERNIGHT", timeInForce: "ioc" }))?.includes("day or gtc"));
  assert.ok(validateEquityTicket(ticket({ limitPrice: 500.001 }))?.includes("two decimals"));
});

test("Sunday 8pm reopen and Friday overnight close", () => {
  assert.equal(marketSession(new Date("2026-11-16T01:00:00Z")), "OVERNIGHT"); // Sun 20:00 ET
  assert.equal(marketSession(new Date("2026-11-21T01:00:00Z")), "CLOSED"); // Fri 20:00 ET
  assert.equal(marketSession(new Date("2026-11-20T08:30:00Z")), "OVERNIGHT"); // Fri 03:30 ET
});

test("risk-reducing exit persists without entry gate approval", () => {
  const dir = mkdtempSync(join(tmpdir(), "adv-"));
  const j = new HermesJournal(join(dir, "j.json"));
  const r = prepareEquityTicket(ticket({ side: "sell", singleUseId: "exit-1" }), quote(), j, null);
  assert.equal(r.intentPersisted, true);
  assert.equal(r.submitted, false);
  rmSync(dir, { recursive: true, force: true });
});
