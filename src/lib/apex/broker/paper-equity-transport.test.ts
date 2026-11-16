import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PAPER_POST_ENABLED, PAPER_STATES, preparePaperLimit, validateEvidence, type BrokerEvidence, type PaperLimitTicket } from "./paper-equity-transport.ts";
import { HermesJournal } from "../live/journal.ts";
import { architectureReadiness } from "../live/architecture.ts";

const now = Date.parse("2026-11-16T15:00:00Z");
const evidence = (): BrokerEvidence => ({
  fetchedAt: new Date(now).toISOString(),
  http: { account: 200, clock: 200, positions: 200, openOrders: 200, quote: 200 },
  accountActive: true,
  tradingBlocked: false,
  clockOpen: true,
  positions: [],
  openOrders: 0,
  quote: { bid: 749.9, ask: 750, timestamp: new Date(now).toISOString() },
});
const ticket = (over: Partial<PaperLimitTicket> = {}): PaperLimitTicket => ({
  symbol: "SPY", side: "buy", orderType: "limit", timeInForce: "day", qty: 0.03, limitPrice: 750,
  session: "REGULAR", clientOrderId: "apex-spy-unique", expiresAt: "2026-11-16T16:00:00-05:00", exitAuthorizationId: null, ...over,
});

test("agent-written OPERATOR_FILE is not approval and auth is not consumed", () => {
  const dir = mkdtempSync(join(tmpdir(), "p-"));
  const j = new HermesJournal(join(dir, "j.json"));
  delete process.env.APEX_OPERATOR_SECRET;
  const fake = { source: "OPERATOR_FILE", clientOrderId: "apex-spy-unique", symbol: "SPY", side: "buy", qty: 0.03, limitPrice: 750, session: "REGULAR", expiresAt: ticket().expiresAt, quoteTimestamp: evidence().quote.timestamp, proof: "aa" };
  const r = preparePaperLimit(ticket(), j, evidence(), fake as never, { now });
  assert.equal(r.submitted, false);
  assert.equal(r.authorizationConsumed, false);
  assert.equal(r.state, "PROPOSED");
  assert.equal(j.isConsumed("apex-spy-unique"), false);
  rmSync(dir, { recursive: true, force: true });
});

test("incomplete, stale, future and nonfinite evidence is rejected", () => {
  assert.ok(validateEvidence({ ...evidence(), http: { ...evidence().http, quote: 500 } }, now));
  assert.ok(validateEvidence({ ...evidence(), fetchedAt: new Date(now - 6_000).toISOString() }, now));
  assert.ok(validateEvidence({ ...evidence(), quote: { ...evidence().quote, timestamp: new Date(now + 10_000).toISOString() } }, now));
  assert.ok(validateEvidence({ ...evidence(), quote: { bid: Number.NaN, ask: 1, timestamp: evidence().quote.timestamp } }, now));
});

test("sell requires separate authorization and cannot oversell", () => {
  const dir = mkdtempSync(join(tmpdir(), "p-"));
  const j = new HermesJournal(join(dir, "j.json"));
  const owned = { ...evidence(), positions: [{ symbol: "SPY", qty: 0.02 }] };
  const sell = ticket({ side: "sell", clientOrderId: "sell-1", qty: 0.03 });
  assert.ok(preparePaperLimit(sell, j, owned, null, { now }).reason.includes("separate"));
  assert.ok(preparePaperLimit({ ...sell, exitAuthorizationId: "exit-1" }, j, owned, null, { now }).reason.includes("exceeds"));
  rmSync(dir, { recursive: true, force: true });
});

test("POST disabled preserves states and does not consume authorization", () => {
  const dir = mkdtempSync(join(tmpdir(), "p-"));
  const path = join(dir, "j.json");
  const r = preparePaperLimit(ticket(), new HermesJournal(path), evidence(), null, { now });
  assert.equal(PAPER_POST_ENABLED, false);
  assert.equal(r.state, "PROPOSED");
  assert.equal(r.authorizationConsumed, false);
  assert.equal(new HermesJournal(path).get("apex-spy-unique")?.paperState, "PROPOSED");
  assert.deepEqual([...PAPER_STATES], ["PROPOSED", "AUTHORIZED", "SUBMISSION_ATTEMPTED", "BROKER_CONFIRMED", "UNKNOWN", "CLOSED"]);
  rmSync(dir, { recursive: true, force: true });
});

test("six-stage journal records a hypothetical BUY-to-EXIT lifecycle", () => {
  const dir = mkdtempSync(join(tmpdir(), "p-"));
  const path = join(dir, "j.json");
  const j = new HermesJournal(path);
  const stages = ["PROPOSED", "AUTHORIZED", "SUBMISSION_ATTEMPTED", "BROKER_CONFIRMED", "UNKNOWN", "CLOSED"] as const;
  for (const state of stages) {
    j.persist({
      clientOrderId: `buy-${state}`,
      ticket: { category: "CONNECTIVITY_TEST", symbol: "SPY", side: "buy", orderType: "limit", maxNotional: 25, expiry: "2099-01-01", singleUseId: `buy-${state}`, readAuthorized: true, orderAuthorized: false, confirmed: false },
      createdAt: new Date(now).toISOString(),
      status: "PERSISTED",
      filledQty: 0,
      avgPrice: null,
      paperState: state,
    });
  }
  j.persist({
    clientOrderId: "sell-closed",
    ticket: { category: "CONNECTIVITY_TEST", symbol: "SPY", side: "sell", orderType: "limit", maxNotional: 25, expiry: "2099-01-01", singleUseId: "sell-closed", readAuthorized: true, orderAuthorized: false, confirmed: false },
    createdAt: new Date(now).toISOString(),
    status: "PERSISTED",
    filledQty: 0.03,
    avgPrice: 750,
    paperState: "CLOSED",
  });
  const restarted = new HermesJournal(path);
  assert.equal(restarted.get("buy-BROKER_CONFIRMED")?.paperState, "BROKER_CONFIRMED");
  assert.equal(restarted.get("sell-closed")?.paperState, "CLOSED");
  assert.equal(architectureReadiness().length, 6);
  rmSync(dir, { recursive: true, force: true });
});
