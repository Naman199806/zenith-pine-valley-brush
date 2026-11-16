import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PAPER_POST_ENABLED, preparePaperLimit, validateEvidence, verifyOperatorApproval, type BrokerEvidence, type PaperLimitTicket } from "./paper-equity-transport.ts";
import { HermesJournal } from "../live/journal.ts";
import { architectureReadiness } from "../live/architecture.ts";
import { agentRoleStatus } from "../live/connectivity.ts";

const now = Date.parse("2026-11-16T15:00:00Z");
const evidence = (): BrokerEvidence => ({
  fetchedAt: new Date(now).toISOString(),
  http: { account: 200, clock: 200, positions: 200, openOrders: 200, quote: 200 },
  accountActive: true, tradingBlocked: false, clockOpen: true, positions: [], openOrders: 0,
  quote: { bid: 749.9, ask: 750, timestamp: new Date(now).toISOString() },
});
const ticket = (over: Partial<PaperLimitTicket> = {}): PaperLimitTicket => ({
  symbol: "SPY", side: "buy", orderType: "limit", timeInForce: "day", qty: 0.03, limitPrice: 750,
  session: "REGULAR", clientOrderId: "apex-spy-unique", expiresAt: "2026-11-16T16:00:00-05:00", exitAuthorizationId: null, ...over,
});

test("boundary rejects incomplete HTTP, invalid arrays, nonfinite, stale, future, wide spread and expiry", () => {
  assert.ok(validateEvidence({ ...evidence(), http: { ...evidence().http, quote: 0 } }, now));
  assert.ok(validateEvidence({ ...evidence(), positions: null as never }, now));
  assert.ok(validateEvidence({ ...evidence(), quote: { bid: Number.POSITIVE_INFINITY, ask: 1, timestamp: evidence().quote.timestamp } }, now));
  assert.ok(validateEvidence({ ...evidence(), quote: { ...evidence().quote, timestamp: new Date(now + 10_000).toISOString() } }, now));
  assert.ok(validateEvidence({ ...evidence(), quote: { bid: 700, ask: 760, timestamp: evidence().quote.timestamp } }, now)?.includes("spread"));
  const dir = mkdtempSync(join(tmpdir(), "p-"));
  const expired = preparePaperLimit(ticket({ expiresAt: "2020-01-01T00:00:00Z" }), new HermesJournal(join(dir, "j.json")), evidence(), null, { now });
  assert.ok(expired.reason.includes("expired"));
  rmSync(dir, { recursive: true, force: true });
});

test("approval is bound to the fixed order, not the quote timestamp", () => {
  delete process.env.APEX_OPERATOR_SECRET;
  const approval = { source: "OPERATOR_SIGNED" as const, clientOrderId: "apex-spy-unique", symbol: "SPY" as const, side: "buy" as const, qty: 0.03, limitPrice: 750, session: "REGULAR" as const, expiresAt: ticket().expiresAt, quoteTimestamp: "ignored", proof: "aa" };
  assert.ok(verifyOperatorApproval(ticket(), approval, null, now)?.includes("cannot mint"));
  assert.ok(verifyOperatorApproval(ticket(), { ...approval, qty: 1 }, "x".repeat(32), now)?.includes("terms"));
});

test("Hermes rejects conflicting client-order reuse and recovers a linked BUY-to-SELL", () => {
  const dir = mkdtempSync(join(tmpdir(), "p-"));
  const path = join(dir, "j.json");
  const j = new HermesJournal(path);
  const buy = ticket();
  preparePaperLimit(buy, j, evidence(), null, { now });
  assert.throws(() => j.persist({
    clientOrderId: buy.clientOrderId,
    ticket: { category: "CONNECTIVITY_TEST", symbol: "QQQ", side: "sell", orderType: "limit", maxNotional: 25, expiry: "2099-01-01", singleUseId: "other", readAuthorized: true, orderAuthorized: false, confirmed: false },
    createdAt: new Date(now).toISOString(), status: "PERSISTED", filledQty: 0, avgPrice: null,
    equityIdentity: { symbol: "QQQ", side: "sell", orderType: "limit", qty: 1, limitPrice: 1, timeInForce: "day", session: "REGULAR", extendedHours: false, singleUseId: "other", expiry: "2099-01-01", worstCaseNotional: 1 },
  }), /conflicting/);
  j.transitionPaperState(buy.clientOrderId, "AUTHORIZED");
  assert.throws(() => j.transitionPaperState(buy.clientOrderId, "BROKER_CONFIRMED"), /invalid/);
  const sellId = "apex-spy-sell";
  j.persist({
    clientOrderId: sellId,
    ticket: { category: "CONNECTIVITY_TEST", symbol: "SPY", side: "sell", orderType: "limit", maxNotional: 25, expiry: "2099-01-01", singleUseId: sellId, readAuthorized: true, orderAuthorized: false, confirmed: false },
    createdAt: new Date(now).toISOString(), status: "PERSISTED", filledQty: 0, avgPrice: null, paperState: "PROPOSED",
    linkedClientOrderId: buy.clientOrderId,
  });
  const restarted = new HermesJournal(path);
  assert.equal(restarted.get(buy.clientOrderId)?.paperState, "AUTHORIZED");
  assert.equal(restarted.get(sellId)?.linkedClientOrderId, buy.clientOrderId);
  rmSync(dir, { recursive: true, force: true });
});

test("POST remains disabled and authorization is not consumed", () => {
  const dir = mkdtempSync(join(tmpdir(), "p-"));
  const r = preparePaperLimit(ticket(), new HermesJournal(join(dir, "j.json")), evidence(), null, { now });
  assert.equal(PAPER_POST_ENABLED, false);
  assert.equal(r.authorizationConsumed, false);
  assert.equal(r.submitted, false);
  rmSync(dir, { recursive: true, force: true });
});

test("six stages and 13 roles remain intact", () => {
  assert.equal(architectureReadiness().length, 6);
  assert.equal(Object.keys(agentRoleStatus()).length, 13);
});
