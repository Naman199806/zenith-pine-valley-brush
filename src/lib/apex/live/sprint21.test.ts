import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { worstCaseNotional, marketSession } from "./equity.ts";
import { prepareEquityTicket, validateEquityTicket, identityMatches, proposedBrokerBody, type EquityTicket } from "./equity-adapter.ts";
import { HermesJournal } from "./journal.ts";
import { issueGateProof } from "./executor.ts";
import { CONNECTIVITY_TEST } from "./connectivity.ts";

const now = new Date("2026-11-16T15:00:00Z");
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
  singleUseId: "adv-1",
  readAuthorized: true,
  orderAuthorized: true,
  confirmed: true,
  session: "REGULAR",
  fractionable: true,
  ...over,
});

const quote = () => ({ bid: 500, ask: 500.02, timestamp: now.toISOString() });
const proofFor = (t: EquityTicket) => issueGateProof(
  { singleUseId: t.singleUseId, symbol: t.symbol, side: t.side, qty: t.qty, limitPrice: t.limitPrice },
  { dataIntegrityOk: true, riskOk: true, notional: t.maxNotional },
  now,
);

test("worst-case notional rejects qty × limit exceeding approved cap", () => {
  assert.ok(worstCaseNotional(0.1, 500, 10) > 25);
  assert.ok(validateEquityTicket(ticket({ qty: 0.1, limitPrice: 500, maxNotional: 25 }))?.includes("worst-case"));
  assert.equal(validateEquityTicket(ticket({ qty: 0.01, limitPrice: 500, maxNotional: 10 })), null);
});

test("hand-built approval object is rejected; proof must be computed", () => {
  const dir = mkdtempSync(join(tmpdir(), "adv-"));
  const j = new HermesJournal(join(dir, "j.json"));
  const t = ticket();
  const fake = { ...proofFor(t), proof: "forged" };
  const r = prepareEquityTicket(t, quote(), j, fake, { now, calendar });
  assert.equal(r.intentPersisted, false);
  assert.ok(r.reason.includes("independently computed") || r.reason.includes("proof"));
  rmSync(dir, { recursive: true, force: true });
});

test("persisted identity matches every execution-critical field", () => {
  const dir = mkdtempSync(join(tmpdir(), "adv-"));
  const j = new HermesJournal(join(dir, "j.json"));
  const t = ticket({ singleUseId: "id-1" });
  const r = prepareEquityTicket(t, quote(), j, proofFor(t), { now, calendar });
  assert.equal(r.intentPersisted, true);
  const proposed = proposedBrokerBody(r.identity!, r.clientOrderId!);
  assert.equal(identityMatches(r.identity!, proposed), true);
  assert.equal(r.identity?.qty, 0.01);
  assert.equal(r.identity?.session, "REGULAR");
  assert.equal(r.identity?.singleUseId, "id-1");
  assert.equal(j.get(r.clientOrderId!)?.equityIdentity?.expiry, t.expiry);
  rmSync(dir, { recursive: true, force: true });
});

test("Alpaca rejects fractional gtc, market BUY, and overnight market", () => {
  assert.ok(validateEquityTicket(ticket({ qty: 0.5, timeInForce: "gtc" }))?.includes("fractional"));
  assert.ok(validateEquityTicket(ticket({ orderType: "market", limitPrice: 100 }))?.includes("limit"));
  assert.ok(validateEquityTicket(ticket({ qty: 1, session: "OVERNIGHT", timeInForce: "ioc" }))?.includes("day or gtc"));
});

test("Sunday 8pm reopen and Friday overnight close", () => {
  assert.equal(marketSession(new Date("2026-11-16T01:00:00Z")), "OVERNIGHT");
  assert.equal(marketSession(new Date("2026-11-21T01:00:00Z")), "CLOSED");
  assert.equal(marketSession(new Date("2026-11-20T08:30:00Z")), "OVERNIGHT");
});

test("risk-reducing exit requires position snapshot and distinct auth", () => {
  const dir = mkdtempSync(join(tmpdir(), "adv-"));
  const j = new HermesJournal(join(dir, "j.json"));
  const noPos = prepareEquityTicket(ticket({ side: "sell", singleUseId: "exit-1" }), quote(), j, null, { now, calendar });
  assert.ok(noPos.reason.includes("position"));
  const ok = prepareEquityTicket(ticket({ side: "sell", singleUseId: "exit-2" }), quote(), j, null, { now, calendar, positions: { ownedQty: 0.01, openExitQty: 0 } });
  assert.equal(ok.intentPersisted, true);
  const over = prepareEquityTicket(ticket({ side: "sell", singleUseId: "exit-3", qty: 1 }), quote(), j, null, { now, calendar, positions: { ownedQty: 0.01, openExitQty: 0 } });
  assert.ok(over.reason.includes("exceeds"));
  const conflict = prepareEquityTicket(ticket({ side: "sell", singleUseId: "exit-4" }), quote(), j, null, { now, calendar, positions: { ownedQty: 0.01, openExitQty: 0.01 } });
  assert.ok(conflict.reason.includes("conflicting"));
  rmSync(dir, { recursive: true, force: true });
});
