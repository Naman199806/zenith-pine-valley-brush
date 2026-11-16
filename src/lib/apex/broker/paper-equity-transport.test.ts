import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { issueOperatorAuth, preparePaperLimit, validatePaperLimit, type PaperLimitTicket } from "./paper-equity-transport.ts";
import { HermesJournal } from "../live/journal.ts";
import { issueGateProof } from "../live/executor.ts";
import { architectureReadiness } from "../live/architecture.ts";

const AUTH = "operator-auth-secret-32-characters";
const GATE = "gate-proof-secret-32-characters-ok";
const now = Date.parse("2026-11-16T15:00:00Z");

const ticket = (over: Partial<PaperLimitTicket> = {}): PaperLimitTicket => ({
  symbol: "SPY",
  side: "buy",
  orderType: "limit",
  timeInForce: "day",
  qty: 0.03,
  limitPrice: 750,
  session: "REGULAR",
  clientOrderId: "apex-spy-unique",
  expiresAt: "2026-11-16T16:00:00-05:00",
  quoteTimestamp: new Date(now).toISOString(),
  quoteSpreadBps: 5,
  exitAuthorizationId: null,
  ...over,
});

function ready(t = ticket()) {
  return {
    auth: issueOperatorAuth(t, AUTH, new Date(now)),
    proof: issueGateProof({ singleUseId: t.clientOrderId, symbol: t.symbol, side: t.side, qty: t.qty, limitPrice: t.limitPrice }, { dataIntegrityOk: true, riskOk: true, notional: 25 }, new Date(now), GATE),
  };
}

test("missing, mismatched and expired proofs are rejected", () => {
  const dir = mkdtempSync(join(tmpdir(), "p-"));
  const j = new HermesJournal(join(dir, "j.json"));
  const t = ticket();
  const { auth, proof } = ready(t);
  assert.equal(preparePaperLimit(t, j, null, proof, { now, authSecret: AUTH, gateSecret: GATE }).intentPersisted, false);
  assert.equal(preparePaperLimit(t, j, auth, null, { now, authSecret: AUTH, gateSecret: GATE }).intentPersisted, false);
  const mismatch = { ...auth!, proof: "0".repeat(64) };
  assert.ok(preparePaperLimit(t, j, mismatch, proof, { now, authSecret: AUTH, gateSecret: GATE }).reason.includes("mismatch"));
  const expired = ticket({ expiresAt: "2020-01-01T00:00:00Z" });
  assert.ok(validatePaperLimit(expired, now)?.includes("expired"));
  rmSync(dir, { recursive: true, force: true });
});

test("journal stores LIMIT fields, never MARKET", () => {
  const dir = mkdtempSync(join(tmpdir(), "p-"));
  const path = join(dir, "j.json");
  const j = new HermesJournal(path);
  const t = ticket();
  const { auth, proof } = ready(t);
  const r = preparePaperLimit(t, j, auth, proof, { now, authSecret: AUTH, gateSecret: GATE });
  assert.equal(r.submitted, false);
  assert.equal(r.enabled, false);
  const saved = new HermesJournal(path).get(t.clientOrderId);
  assert.equal(saved?.ticket.orderType, "limit");
  assert.equal(saved?.equityIdentity?.orderType, "limit");
  assert.equal(saved?.equityIdentity?.qty, 0.03);
  assert.equal(saved?.equityIdentity?.limitPrice, 750);
  assert.equal(saved?.equityIdentity?.timeInForce, "day");
  assert.equal(saved?.equityIdentity?.session, "REGULAR");
  rmSync(dir, { recursive: true, force: true });
});

test("injected POST callback cannot make production submit", () => {
  const dir = mkdtempSync(join(tmpdir(), "p-"));
  const j = new HermesJournal(join(dir, "j.json"));
  const t = ticket({ clientOrderId: "no-post" });
  const { auth, proof } = ready(t);
  const injected = { post: () => { throw new Error("must not be called"); } };
  const r = preparePaperLimit(t, j, auth, proof, { now, authSecret: AUTH, gateSecret: GATE, ...({ transport: injected } as object) });
  assert.equal(r.submitted, false);
  assert.equal(r.enabled, false);
  rmSync(dir, { recursive: true, force: true });
});

test("preflight validation rejects bad quote, account and quantity", () => {
  assert.ok(validatePaperLimit(ticket({ quoteTimestamp: new Date(now - 6_000).toISOString() }), now));
  assert.ok(validatePaperLimit(ticket({ quoteSpreadBps: 21 }), now));
  assert.ok(validatePaperLimit(ticket({ qty: 0 }), now));
  assert.ok(validatePaperLimit(ticket({ limitPrice: Number.NaN }), now));
});

test("six-stage trace has the original ordered stages", () => {
  const stages = architectureReadiness().map((s) => s.stage);
  assert.deepEqual(stages, [
    "1. Market Data",
    "2. Scanner",
    "3. 13 Agents",
    "4. Decision Gates",
    "5. Execution",
    "6. Hermes",
  ]);
});
