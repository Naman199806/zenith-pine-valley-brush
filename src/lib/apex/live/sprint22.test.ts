process.env.APEX_GATE_SECRET = "test-only-gate-secret-32chars-min";
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareEquityTicket, identityMatches, proposedBrokerBody, type EquityTicket } from "./equity-adapter.ts";
import { HermesJournal } from "./journal.ts";
import { issueGateProof } from "./executor.ts";
import { CONNECTIVITY_TEST } from "./connectivity.ts";
import { agentRoleStatus } from "./connectivity.ts";
import { architectureReadiness } from "./architecture.ts";

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
  singleUseId: "s22",
  readAuthorized: true,
  orderAuthorized: true,
  confirmed: true,
  session: "REGULAR",
  fractionable: true,
  ...over,
});

const quote = () => ({ bid: 500, ask: 500.02, timestamp: now.toISOString() });
const SECRET = process.env.APEX_GATE_SECRET!;
const proofFor = (t: EquityTicket, at = now) => issueGateProof(
  { singleUseId: t.singleUseId, symbol: t.symbol, side: t.side, qty: t.qty, limitPrice: t.limitPrice },
  { dataIntegrityOk: true, riskOk: true, notional: t.maxNotional },
  at,
  SECRET,
);

test("mismatched quantity between ticket and proof is rejected", () => {
  const dir = mkdtempSync(join(tmpdir(), "s22-"));
  const j = new HermesJournal(join(dir, "j.json"));
  const t = ticket({ qty: 0.01 });
  const proof = proofFor(ticket({ qty: 0.009, singleUseId: t.singleUseId }));
  const r = prepareEquityTicket(t, quote(), j, proof, { now, calendar });
  assert.equal(r.intentPersisted, false);
  assert.ok(r.reason.includes("mismatch") || r.reason.includes("proof"));
  rmSync(dir, { recursive: true, force: true });
});

test("session tampering is rejected against recomputed session", () => {
  const dir = mkdtempSync(join(tmpdir(), "s22-"));
  const j = new HermesJournal(join(dir, "j.json"));
  const t = ticket({ session: "OVERNIGHT", singleUseId: "tamper" });
  const r = prepareEquityTicket(t, quote(), j, proofFor(t), { now, calendar });
  assert.equal(r.intentPersisted, false);
  assert.ok(r.reason.includes("session mismatch"));
  const missing = prepareEquityTicket(ticket({ singleUseId: "nocal" }), quote(), j, null, { now, calendar: null });
  assert.ok(missing.reason.includes("calendar"));
  rmSync(dir, { recursive: true, force: true });
});

test("reused ticket and stale approval are rejected", () => {
  const dir = mkdtempSync(join(tmpdir(), "s22-"));
  const path = join(dir, "j.json");
  const j = new HermesJournal(path);
  const t = ticket({ singleUseId: "reuse" });
  const first = prepareEquityTicket(t, quote(), j, proofFor(t), { now, calendar });
  assert.equal(first.intentPersisted, true);
  const second = prepareEquityTicket(t, quote(), j, proofFor(t), { now, calendar });
  assert.ok(second.reason.includes("consumed"));
  const stale = ticket({ singleUseId: "stale" });
  const old = new Date(now.getTime() - 120_000);
  const r = prepareEquityTicket(stale, quote(), j, proofFor(stale, old), { now, calendar });
  assert.ok(r.reason.includes("stale"));
  const j2 = new HermesJournal(path);
  assert.equal(j2.isConsumed("reuse"), true);
  assert.equal(identityMatches(first.identity!, proposedBrokerBody(first.identity!, first.clientOrderId!)), true);
  rmSync(dir, { recursive: true, force: true });
});

test("duplicate exit and partial-fill quantity are refused", () => {
  const dir = mkdtempSync(join(tmpdir(), "s22-"));
  const j = new HermesJournal(join(dir, "j.json"));
  const dup = prepareEquityTicket(ticket({ side: "sell", singleUseId: "dup-exit" }), quote(), j, null, {
    now, calendar, positions: { ownedQty: 0.02, openExitQty: 0.01 },
  });
  assert.ok(dup.reason.includes("conflicting"));
  const over = prepareEquityTicket(ticket({ side: "sell", singleUseId: "over-exit", qty: 0.05 }), quote(), j, null, {
    now, calendar, positions: { ownedQty: 0.02, openExitQty: 0 },
  });
  assert.ok(over.reason.includes("exceeds"));
  rmSync(dir, { recursive: true, force: true });
});

test("rounded quantity that changes worst-case notional is rejected", () => {
  const r = prepareEquityTicket(
    ticket({ qty: 0.0500000001, limitPrice: 500, maxNotional: 25, singleUseId: "round" }),
    quote(),
    new HermesJournal(join(mkdtempSync(join(tmpdir(), "s22-")), "j.json")),
    null,
    { now, calendar },
  );
  assert.equal(r.submitted, false);
  assert.equal(r.enabled, false);
});

test("six stages and 13 agents remain intact; transport hard-disabled", () => {
  assert.equal(architectureReadiness().length, 6);
  assert.equal(Object.keys(agentRoleStatus()).length, 13);
  const dir = mkdtempSync(join(tmpdir(), "s22-"));
  const j = new HermesJournal(join(dir, "j.json"));
  const t = ticket({ singleUseId: "hard" });
  const r = prepareEquityTicket(t, quote(), j, proofFor(t), { now, calendar });
  assert.equal(r.enabled, false);
  assert.equal(r.submitted, false);
  rmSync(dir, { recursive: true, force: true });
});
