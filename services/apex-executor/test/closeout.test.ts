/**
 * Track A closeout. Fees, qualification, expiry, and absence evidence.
 * Fake clock, injected broker, no network.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SUPERVISED_PAPER_TEST } from "../../../src/lib/apex/live/connectivity.ts";
import { validateTicket } from "../../../src/lib/apex/live/executor.ts";
import { contributesToStrategyQualification, ingestOutcomes } from "../../../src/lib/apex/research/hermes-outcomes.ts";
import { FILL_PAGE_LIMIT, absenceVerdict, readFillPage, readOrderList } from "../src/absence.ts";
import { fillsFromActivities } from "../src/alpaca-fill.ts";
import type { PaperWriter } from "../src/broker-write.ts";
import { hermesPerformanceRefusal, toResearchOutcome, trustedEvidence } from "../src/fill-event.ts";
import { Executor, openMarket, type ExecutorConfig } from "../src/runtime.ts";
import { signSupervisedGate, signSupervisedOrder, verifySupervisedOrder, type SupervisedOrder } from "../src/supervised-order.ts";

const now = Date.parse("2026-11-16T15:00:00Z");
const SECRET = "operator-secret-32-characters-min";
const GATE = "gate-secret-value-32-characters-ok";

function env(): NodeJS.ProcessEnv {
  return { ...process.env, APEX_OPERATOR_SECRET: SECRET, APEX_GATE_SECRET: GATE, PAPER_POST_ENABLED: "true" };
}

function start(dir: string): Executor {
  process.env.APEX_OPERATOR_SECRET = SECRET;
  process.env.APEX_GATE_SECRET = GATE;
  const config: ExecutorConfig = {
    mode: "PAPER", postEnabled: false, liveCredentialsLoaded: false,
    statePath: join(dir, "state.json"), lockPath: join(dir, "writer.lock"), inboxPath: join(dir, "inbox.jsonl"),
    journalPath: join(dir, "journal.jsonl"), hermesPath: join(dir, "hermes.json"), fillsPath: join(dir, "fills.jsonl"),
  };
  const exec = new Executor(config, { keyId: "PKTESTKEY1", secret: "paper-secret" });
  exec.observeMarket(openMarket(now), now);
  return exec;
}

function buy(expiresAt = "2099-01-01T00:00:00Z"): SupervisedOrder {
  const draft = {
    v: 1 as const, source: "OPERATOR_SIGNED" as const, category: "SUPERVISED_PAPER_TEST" as const, symbol: "SPY" as const,
    side: "buy" as const, orderType: "market_notional" as const, timeInForce: "day" as const, extendedHours: false as const,
    notional: "2.00", clientOrderId: "close-buy", expiresAt, nonce: "close-buy-nonce", session: "REGULAR" as const,
    exitAuthorizationId: null, linkedEntryId: null, decisionId: "close", strategyId: "supervised-paper", strategyVersion: "v1",
    strategyApproved: false as const, operatorProof: null, gateProof: null,
  };
  const order = draft as SupervisedOrder;
  order.operatorProof = signSupervisedOrder(order, SECRET);
  order.gateProof = signSupervisedGate(order, GATE, now);
  return order;
}

function activity(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    activity_type: "FILL", id: "202611160001::fill", cum_qty: "0.02", leaves_qty: "0", price: "100", qty: "0.02",
    side: "buy", symbol: "SPY", transaction_time: "2026-11-16T15:01:00Z", order_id: "brk-close", type: "fill", ...over,
  };
}

test("a broker fee of 0 is known and a missing fee is stored without net-profit attribution", () => {
  const known = fillsFromActivities({
    decisionId: "d", strategyVersion: "v1", clientOrderId: "close-buy", symbol: "SPY", side: "buy", intendedPrice: 100,
    activities: [activity({ fee: "0" })], evidenceChannel: "alpaca-http",
  }).events[0];
  assert.ok(known);
  assert.equal(known.fee, 0);
  assert.equal(known.feeKnown, true);
  assert.equal(known.feeSource, "broker");
  assert.equal(known.netPnlAttributable, true);
  assert.equal(known.brokerOrderId, "brk-close");
  assert.equal(known.fillId, "202611160001::fill");
  assert.equal(hermesPerformanceRefusal(known), null);

  const omitted = fillsFromActivities({
    decisionId: "d", strategyVersion: "v1", clientOrderId: "close-buy", symbol: "SPY", side: "buy", intendedPrice: 100,
    activities: [activity()], evidenceChannel: "alpaca-http",
  }).events[0];
  assert.ok(omitted);
  assert.equal(omitted.fee, null);
  assert.equal(omitted.feeKnown, false);
  assert.equal(omitted.netPnlAttributable, false);
  assert.equal(omitted.qty, 0.02);
  assert.equal(omitted.fillPrice, 100);
  assert.equal(omitted.provenance, "broker");
  assert.match(hermesPerformanceRefusal(omitted) ?? "", /fee unknown/);
  const report = ingestOutcomes([{ ...toResearchOutcome(omitted), category: "CONNECTIVITY_TEST" }], trustedEvidence([omitted]));
  assert.equal(report.paper.length, 0);
  assert.equal(report.strategyExcluded, 0);
  assert.match(report.notes.join(" "), /net pnl not attributable/);

  const injected = fillsFromActivities({
    decisionId: "d", strategyVersion: "v1", clientOrderId: "close-buy", symbol: "SPY", side: "buy", intendedPrice: 100,
    activities: [activity({ fee: 0 })], evidenceChannel: "injected",
  }).events[0];
  assert.equal(injected?.netPnlAttributable, false);
  assert.match(hermesPerformanceRefusal(injected!) ?? "", /test evidence/);
});

test("supervised paper fills do not qualify a strategy and the live ticket type still rejects them", () => {
  const known = fillsFromActivities({
    decisionId: "d", strategyVersion: "etf-xs-breakout-20-v1", clientOrderId: "close-buy", symbol: "SPY", side: "buy", intendedPrice: 100,
    activities: [activity({ fee: 0 })], evidenceChannel: "alpaca-http",
  }).events[0]!;
  const outcome = toResearchOutcome(known);
  assert.equal(outcome.category, SUPERVISED_PAPER_TEST);
  assert.equal(contributesToStrategyQualification(outcome), false);
  const report = ingestOutcomes([outcome], trustedEvidence([known]));
  assert.equal(report.paper.length, 0);
  assert.equal(report.strategyExcluded, 1);
  assert.match(validateTicket({
    category: SUPERVISED_PAPER_TEST, symbol: "SPY", side: "buy", orderType: "limit", maxNotional: 25,
    expiry: "2099-01-01T00:00:00Z", singleUseId: "x", readAuthorized: true, orderAuthorized: true, confirmed: true,
  }) ?? "", /CONNECTIVITY_TEST/);
});

test("NaN, Infinity, non-ISO, and out-of-range expiry values and invalid order types are refused", () => {
  const secrets = { operator: SECRET, gate: GATE };
  for (const expiresAt of ["NaN", "Infinity", "-Infinity", "2099-01-01", "2099-01-01T00:00:00+00:00", "not-a-date"]) {
    const order = buy(expiresAt);
    assert.match(verifySupervisedOrder(order, secrets, now) ?? "", /finite timestamp/, expiresAt);
  }
  for (const expiresAt of ["1990-01-01T00:00:00Z", "2200-01-01T00:00:00Z"]) {
    assert.match(verifySupervisedOrder(buy(expiresAt), secrets, now) ?? "", /out of range/, expiresAt);
  }
  const signed = buy();
  for (const orderType of ["limit", "market", "stop", ""]) {
    const bad = { ...signed, orderType } as SupervisedOrder;
    assert.match(verifySupervisedOrder(bad, secrets, now) ?? "", /invalid order type/, orderType);
  }
  assert.equal(verifySupervisedOrder(signed, secrets, now), null);
});

test("malformed order lists and a truncated fill page stay UNKNOWN", async () => {
  assert.equal(readOrderList({ orders: [] }).malformed, true);
  assert.equal(readFillPage(Array.from({ length: FILL_PAGE_LIMIT }, () => ({ activity_type: "FILL" }))).truncated, true);
  assert.equal(readFillPage({ activities: [activity()], next_page_token: "next" }).truncated, true);
  assert.equal(absenceVerdict([{
    byClientStatus: 404, openStatus: "error", allStatus: "error", fillsStatus: 200,
    openHit: false, allHit: false, openTruncated: false, allTruncated: false, fillsTruncated: false, fillHit: false,
  }], 2), "unknown");

  async function hangThen(listOrdersBody: unknown, fillsBody: unknown): Promise<void> {
    const dir = mkdtempSync(join(tmpdir(), "close-abs-"));
    const ex = start(dir);
    try {
    const order = buy();
    ex.acceptSupervised(order, now);
    const hung: PaperWriter = {
      networkWrite: "injected",
      async submit() { return { kind: "ambiguous", reason: "timeout" }; },
      async cancel() { return { kind: "ambiguous", reason: "timeout" }; },
      async getOrder() { return { status: 404, body: { code: 40410000, message: "order not found" } }; },
      async getPositions() { return { status: 200, body: [] }; },
      async getOpenOrders() { return { status: 200, body: [] }; },
      async listOrders() { return { status: 200, body: listOrdersBody }; },
      async listFills() { return { status: 200, body: fillsBody }; },
    };
    assert.equal((await ex.submitPaper(order, hung, env(), now)).orderState, "UNKNOWN");
    const recovered = await ex.recoverInFlight(hung, now, async () => {});
    assert.match(recovered.reason, /without sufficient evidence/);
    assert.equal(ex.get(order.clientOrderId)?.orderState, "UNKNOWN");
    assert.notEqual(ex.get(order.clientOrderId)?.confirmedAbsent, true);
    const replacement = buy();
    const other = { ...replacement, clientOrderId: "close-other", nonce: "close-other" } as SupervisedOrder;
    other.operatorProof = signSupervisedOrder(other, SECRET);
    other.gateProof = signSupervisedGate(other, GATE, now);
    assert.match((await ex.submitPaper(other, hung, env(), now)).reason, /UNKNOWN|in-flight/);
    } finally {
      ex.release();
      rmSync(dir, { recursive: true, force: true });
    }
  }

  await hangThen({ orders: [] }, []);
  const page = Array.from({ length: FILL_PAGE_LIMIT }, (_, i) => activity({ id: `fill-${i}`, order_id: "someone-else" }));
  await hangThen([], page);
});
