/**
 * Supervised PAPER lifecycle. Fake clock, fake broker, no network.
 * STRATEGY_TRADE stays blocked. strategyApproved stays false.
 * The real adapter throws before fetch.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { proposedTicket, signApproval, type CanonicalApproval } from "../src/approval.ts";
import { TRADING_API_BUDGET_PER_MIN, outstandingOrderCap } from "../src/budget.ts";
import { createAlpacaPaperTransport, createPaperPollClient } from "../src/broker.ts";
import { ProcessCrash, createDisabledPaperWriter, type PaperWriter } from "../src/broker-write.ts";
import { hermesPerformanceRefusal } from "../src/fill-event.ts";
import { LIVE_POST_ENABLED, PAPER_POST_ENABLED, POST_ENABLED, STRATEGY_APPROVED, Executor, openMarket, type ExecutorConfig } from "../src/runtime.ts";
import { MODE_GATE } from "../src/mode.ts";
import { transitionRefusal } from "../src/order-machine.ts";
import { FRACTIONAL_TRADING_DOC, POST_ORDER_DOC, clientOrderIdProblem, formatNotional } from "../src/order-shape.ts";
import { brokerBodyMismatch, exactBrokerBody, signSupervisedGate, signSupervisedOrder, type SupervisedOrder } from "../src/supervised-order.ts";
import { flatSnapshot } from "../src/risk.ts";
import { issueGateProof } from "../../../src/lib/apex/live/executor.ts";
import type { TradeInstruction } from "../src/instruction.ts";

const now = Date.parse("2026-11-16T15:00:00Z");
const SECRET = "operator-secret-32-characters-min";
const GATE = "gate-secret-value-32-characters-ok";

function approval(over: Partial<CanonicalApproval> = {}): CanonicalApproval {
  return {
    v: 1, source: "OPERATOR_SIGNED", clientOrderId: "spy-buy-1", symbol: "SPY", side: "buy", orderType: "limit",
    timeInForce: "day", qty: 0.02, limitPrice: 100, session: "REGULAR", expiresAt: "2099-01-01T00:00:00Z", nonce: "spy-nonce-1",
    category: "SUPERVISED_PAPER_TEST", exitAuthorizationId: null, linkedEntryId: null, ...over,
  };
}

function instruction(over: Partial<CanonicalApproval> & { notional?: string; qty?: number } = {}, sized?: number, gateOpts?: { dataIntegrityOk?: boolean; riskOk?: boolean }): SupervisedOrder {
  const base = approval(over);
  const sell = base.side === "sell";
  const notional = over.notional ?? (sized != null ? sized.toFixed(2) : "2.00");
  const qty = typeof over.qty === "number" ? String(over.qty) : "0.02";
  const draft = {
    v: 1 as const,
    source: "OPERATOR_SIGNED" as const,
    category: "SUPERVISED_PAPER_TEST" as const,
    symbol: "SPY" as const,
    side: base.side,
    orderType: sell ? "market_qty" as const : "market_notional" as const,
    timeInForce: "day" as const,
    extendedHours: false as const,
    clientOrderId: base.clientOrderId,
    expiresAt: base.expiresAt,
    nonce: base.nonce,
    session: "REGULAR" as const,
    decisionId: "supervised-decision",
    strategyId: "supervised-paper",
    strategyVersion: "v1",
    strategyApproved: false as const,
    operatorProof: null,
    gateProof: null,
    ...(sell
      ? { qty, exitAuthorizationId: base.exitAuthorizationId ?? "exit", linkedEntryId: base.linkedEntryId ?? "missing-entry" }
      : { notional, exitAuthorizationId: null, linkedEntryId: null }),
  };
  const order = draft as SupervisedOrder;
  order.operatorProof = signSupervisedOrder(order, SECRET);
  order.gateProof = signSupervisedGate(order, GATE, now, {
    sigmaVeto: gateOpts?.dataIntegrityOk === false,
    sentinelVeto: gateOpts?.riskOk === false,
  });
  return order;
}

function limitTicket(): TradeInstruction {
  const base = approval({ category: "CONNECTIVITY_TEST", clientOrderId: "limit-buy", nonce: "limit-nonce" });
  const gate = issueGateProof(
    { singleUseId: base.clientOrderId, symbol: base.symbol, side: base.side, qty: base.qty, limitPrice: base.limitPrice },
    { dataIntegrityOk: true, riskOk: true, notional: 2 },
    new Date(now),
    GATE,
  );
  return {
    ...base,
    decisionId: "limit-decision",
    strategyId: "connectivity",
    strategyVersion: "v1",
    strategyApproved: false,
    evidenceTimestamp: new Date(now).toISOString(),
    sizedNotional: 2,
    operatorProof: signApproval(base, SECRET),
    gateProof: gate,
  };
}

function env(over: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = { ...process.env, APEX_OPERATOR_SECRET: SECRET, APEX_GATE_SECRET: GATE, PAPER_POST_ENABLED: "true" };
  for (const [key, value] of Object.entries(over)) {
    if (value === undefined) delete next[key];
    else next[key] = value;
  }
  return next;
}

function paths(dir: string): ExecutorConfig {
  return {
    mode: "PAPER", postEnabled: false, liveCredentialsLoaded: false,
    statePath: join(dir, "state.json"), lockPath: join(dir, "writer.lock"), inboxPath: join(dir, "inbox.jsonl"),
    journalPath: join(dir, "journal.jsonl"), hermesPath: join(dir, "hermes.json"), fillsPath: join(dir, "fills.jsonl"),
  };
}

function start(dir: string): Executor {
  process.env.APEX_OPERATOR_SECRET = SECRET;
  process.env.APEX_GATE_SECRET = GATE;
  const exec = new Executor(paths(dir), { keyId: "PKTESTKEY1", secret: "paper-secret" });
  exec.observeMarket(openMarket(now), now);
  return exec;
}

interface Book {
  submits: object[];
  cancels: string[];
  positions: { symbol: string; qty: string }[];
  open: Record<string, unknown>[];
  orders: Map<string, Record<string, unknown>>;
  fills: Record<string, unknown>[];
  mode: "fill" | "accept" | "reject" | "ambiguous" | "down" | "limit" | "crash" | "partial" | "throw";
  crashAfterRecord: boolean;
  failAfter: number | null;
  probes: number;
}

function book(): Book {
  return { submits: [], cancels: [], positions: [], open: [], orders: new Map(), fills: [], mode: "fill", crashAfterRecord: false, failAfter: null, probes: 0 };
}

function execution(id: string, qty: string, price: string, fee: string | null): Record<string, unknown> {
  const row: Record<string, unknown> = { id, order_id: `brk-${id.split("-")[0]}`, qty, price, transaction_time: "2026-11-16T15:01:00.000Z" };
  if (fee != null) row.fee = fee;
  return row;
}

function writer(state: Book): PaperWriter {
  return {
    networkWrite: "injected",
    async submit(order) {
      state.submits.push(order);
      const row = order as { client_order_id: string; side: string; qty?: string; notional?: string };
      if (state.mode === "throw") throw new Error("timed out");
      if (state.mode === "crash") {
        if (state.crashAfterRecord) {
          state.orders.set(row.client_order_id, { id: `brk-${row.client_order_id}`, client_order_id: row.client_order_id, status: "accepted", filled_qty: "0", symbol: "SPY", side: row.side });
        }
        throw new ProcessCrash();
      }
      if (state.mode === "ambiguous") return { kind: "ambiguous", reason: "timeout" };
      if (state.mode === "down") return { kind: "unavailable", status: 503 };
      if (state.mode === "limit") return { kind: "rate_limit" };
      if (state.mode === "reject") return { kind: "rejected", status: 422, body: { code: 422 } };
      if (state.mode === "accept") {
        const body = { id: `brk-${row.client_order_id}`, client_order_id: row.client_order_id, status: "new", filled_qty: "0", symbol: "SPY", side: row.side };
        state.orders.set(row.client_order_id, body);
        state.open = [body];
        return { kind: "ack", status: 200, body };
      }
      const qty = row.side === "sell" ? String(row.qty) : "0.02";
      const filled = state.mode === "partial" ? "0.01" : qty;
      const body: Record<string, unknown> = {
        id: `brk-${row.client_order_id}`,
        client_order_id: row.client_order_id,
        status: state.mode === "partial" ? "partially_filled" : "filled",
        filled_qty: filled,
        filled_avg_price: "100",
        symbol: "SPY",
        side: row.side,
        type: "market",
        time_in_force: "day",
        extended_hours: false,
      };
      state.orders.set(row.client_order_id, body);
      state.fills.push({
        activity_type: "FILL",
        id: `20191119::${row.client_order_id}`,
        qty: filled,
        price: "100",
        side: row.side,
        symbol: "SPY",
        transaction_time: "2026-11-16T15:01:00.000Z",
        order_id: body.id,
        cum_qty: filled,
        leaves_qty: state.mode === "partial" ? "0.01" : "0",
        type: state.mode === "partial" ? "partial_fill" : "fill",
      });
      if (row.side === "buy") state.positions = [{ symbol: "SPY", qty: filled }];
      else state.positions = [];
      state.open = [];
      return { kind: "ack", status: 200, body };
    },
    async cancel(id) {
      state.cancels.push(id);
      const body = { id: `brk-${id}`, client_order_id: id, status: "canceled", filled_qty: "0", symbol: "SPY", side: "buy" };
      state.orders.set(id, body);
      state.open = [];
      state.positions = [];
      return { kind: "ack", status: 200, body };
    },
    async getOrder(id) {
      state.probes += 1;
      if (state.failAfter != null && state.probes > state.failAfter) return { status: 503, body: null };
      const row = state.orders.get(id);
      return row ? { status: 200, body: row } : { status: 404, body: null };
    },
    async getPositions() {
      return { status: 200, body: state.positions };
    },
    async getOpenOrders() {
      return { status: 200, body: state.open };
    },
    async listOrders(status) {
      if (status === "open") return { status: 200, body: state.open };
      return { status: 200, body: [...state.orders.values()] };
    },
    async listFills() {
      return { status: 200, body: state.fills };
    },
  };
}

test("order transitions, the $25 notional shape, and the outstanding cap are fixed", () => {
  assert.equal(transitionRefusal("intent", "filled"), "illegal order transition intent -> filled");
  assert.equal(transitionRefusal("filled", "submitted"), "illegal order transition filled -> submitted");
  assert.equal(transitionRefusal("submitted", "UNKNOWN"), null);
  assert.equal(transitionRefusal("UNKNOWN", "accepted"), null);
  assert.equal(outstandingOrderCap(), 1);
  assert.equal(TRADING_API_BUDGET_PER_MIN < 200, true);
  assert.equal(formatNotional(25), "25.00");
  assert.equal(formatNotional(25.01), null);
  assert.equal(formatNotional(0.99), null);
  assert.equal(clientOrderIdProblem("a".repeat(48)), "client_order_id must be 1 to 47 characters of letters, digits, underscore, or hyphen");
  assert.equal(clientOrderIdProblem("a".repeat(47)), null);
  const signed = instruction();
  const body = exactBrokerBody(signed);
  assert.equal(body.type, "market");
  assert.equal(body.time_in_force, "day");
  assert.equal(body.extended_hours, false);
  assert.equal(body.notional, "2.00");
  assert.equal("qty" in body, false);
  assert.equal(brokerBodyMismatch(signed, { ...body, notional: "2" }), "broker body notional does not match the signed order");
  assert.match(FRACTIONAL_TRADING_DOC, /docs\.alpaca\.markets/);
  assert.match(POST_ORDER_DOC, /postorder/);
});

test("real broker writer and poll client throw before fetch on POST, PATCH, and DELETE", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return new Response("no");
  }) as typeof fetch;
  const disabled = createDisabledPaperWriter(fetchImpl);
  await assert.rejects(() => disabled.submit({}), /PAPER POST DISABLED/);
  await assert.rejects(() => disabled.cancel("spy-buy-1"), /PAPER POST DISABLED/);
  assert.equal(calls, 0);
  const original = globalThis.fetch;
  const methods: string[] = [];
  globalThis.fetch = (async (_url: unknown, init?: { method?: string }) => {
    methods.push(init?.method ?? "GET");
    return new Response("{}", { status: 401 });
  }) as typeof fetch;
  try {
    const paper = createPaperPollClient({ keyId: "PKTESTKEY1", secret: "paper-secret" });
    const transport = createAlpacaPaperTransport({ keyId: "PKTESTKEY1", secret: "paper-secret" });
    for (const method of ["POST", "PATCH", "DELETE"] as const) {
      await assert.rejects(() => paper.request({ method, url: "https://paper-api.alpaca.markets/v2/orders" }), /PAPER POST DISABLED/);
      await assert.rejects(() => transport.call({ method, url: "https://paper-api.alpaca.markets/v2/orders" }), /PAPER POST DISABLED/);
    }
    assert.deepEqual(methods, []);
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(POST_ENABLED, false);
  assert.equal(PAPER_POST_ENABLED, false);
  assert.equal(LIVE_POST_ENABLED, false);
  assert.equal(STRATEGY_APPROVED, false);
  assert.equal(MODE_GATE.autonomousStrategyTrading, "DISABLED");
});

test("supervised SPY buy and authorized exit reach broker-confirmed FLAT with Hermes costs", async () => {
  const dir = mkdtempSync(join(tmpdir(), "spy-flat-"));
  const ex = start(dir);
  const state = book();
  const broker = writer(state);
  const buy = instruction();
  try {
    assert.equal(ex.acceptSupervised(buy, now).state, "PROPOSED");
    assert.equal(buy.strategyApproved, false);
    assert.equal(buy.category, "SUPERVISED_PAPER_TEST");
    const sent = await ex.submitPaper(buy, broker, env(), now);
    assert.equal(sent.submitted, true);
    assert.equal(sent.orderState, "filled");
    assert.notEqual(ex.get(buy.clientOrderId)?.state, "FLAT");
    assert.equal(state.positions[0]?.qty, "0.02");
    const body = state.submits[0] as { type: string; time_in_force: string; notional: string; side: string; extended_hours: boolean };
    assert.equal(body.type, "market");
    assert.equal(body.time_in_force, "day");
    assert.equal(body.notional, "2.00");
    assert.equal(body.side, "buy");
    assert.equal(body.extended_hours, false);
    assert.equal(ex.fillEvents().length, 1);
    assert.equal(ex.fillEvents()[0]?.fee, null);
    assert.equal(ex.fillEvents()[0]?.feeKnown, false);
    assert.equal(ex.fillEvents()[0]?.evidenceChannel, "injected");
    assert.match(ex.performanceRefusal(ex.fillEvents()[0]!) ?? "", /test evidence/);
    assert.equal(ex.trustedEvidence().length, 0);
    const tooSoon = await broker.getOpenOrders();
    assert.equal(Array.isArray(tooSoon.body) && (tooSoon.body as unknown[]).length, 0);
    const sell = instruction({ side: "sell", clientOrderId: "spy-sell-1", nonce: "spy-sell-nonce", qty: 0.02, exitAuthorizationId: "exit-spy", linkedEntryId: buy.clientOrderId });
    const armed = ex.acceptSupervised(sell, now);
    assert.equal(armed.accepted, true, armed.reason);
    state.mode = "fill";
    const exited = await ex.submitPaper(sell, broker, env(), now);
    assert.equal(exited.orderState, "filled");
    assert.equal(ex.get(sell.clientOrderId)?.state, "FLAT");
    assert.equal(ex.get(buy.clientOrderId)?.state, "FLAT");
    assert.deepEqual(state.positions, []);
    assert.deepEqual(state.open, []);
    const sellBody = state.submits[1] as { side: string; qty: string; type: string; time_in_force: string };
    assert.equal(sellBody.side, "sell");
    assert.equal(sellBody.qty, "0.02");
    assert.equal(sellBody.type, "market");
    assert.equal(sellBody.time_in_force, "day");
    assert.equal("notional" in sellBody, false);
    assert.equal(ex.trustedEvidence().length, 0);
    assert.equal(brokerBodyMismatch(buy, state.submits[0] as object), null);
    assert.equal(brokerBodyMismatch(sell, state.submits[1] as object), null);
    const hermes = readFileSync(join(dir, "hermes.json"), "utf8");
    assert.match(hermes, /SUPERVISED_PAPER_TEST/);
    assert.match(hermes, /strategyApproved=false/);
    assert.equal(hermes.includes(SECRET), false);
    assert.equal(ex.health(now).strategyApproved, false);
    assert.equal(ex.health(now).postEnabled, false);
  } finally {
    ex.release();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("partial fills keep cumulative qty and average and a repeated snapshot does not double them", async () => {
  const dir = mkdtempSync(join(tmpdir(), "spy-part-"));
  const ex = start(dir);
  const state = book();
  state.mode = "partial";
  const broker = writer(state);
  const buy = instruction({ clientOrderId: "spy-part", nonce: "spy-part" });
  try {
    ex.acceptSupervised(buy, now);
    const first = await ex.submitPaper(buy, broker, env(), now);
    assert.equal(first.orderState, "partially_filled");
    assert.equal(ex.get(buy.clientOrderId)?.state, "PARTIAL");
    assert.equal(ex.get(buy.clientOrderId)?.filledQty, 0.01);
    assert.equal(ex.get(buy.clientOrderId)?.avgPrice, 100);
    state.orders.set(buy.clientOrderId, {
      id: `brk-${buy.clientOrderId}`,
      client_order_id: buy.clientOrderId,
      status: "filled",
      filled_qty: "0.02",
      filled_avg_price: "105",
      symbol: "SPY",
      side: "buy",
      type: "market",
      time_in_force: "day",
      extended_hours: false,
    });
    state.fills.push({
      activity_type: "FILL",
      id: `${buy.clientOrderId}-2`,
      qty: "0.01",
      price: "110",
      side: "buy",
      symbol: "SPY",
      transaction_time: "2026-11-16T15:02:00.000Z",
      order_id: `brk-${buy.clientOrderId}`,
      cum_qty: "0.02",
      leaves_qty: "0",
      type: "fill",
    });
    state.positions = [{ symbol: "SPY", qty: "0.02" }];
    const second = await ex.syncPaper(buy.clientOrderId, broker, now);
    assert.equal(second.orderState, "filled");
    assert.equal(ex.get(buy.clientOrderId)?.filledQty, 0.02);
    assert.equal(ex.get(buy.clientOrderId)?.avgPrice, 105);
    assert.deepEqual(ex.fillEvents().map((row) => row.fillPrice), [100, 110]);
    const again = await ex.syncPaper(buy.clientOrderId, broker, now);
    assert.equal(again.orderState, "filled");
    assert.equal(ex.fillEvents().length, 2);
    assert.equal(ex.get(buy.clientOrderId)?.filledQty, 0.02);
    assert.equal(ex.get(buy.clientOrderId)?.avgPrice, 105);
    state.orders.set(buy.clientOrderId, { ...state.orders.get(buy.clientOrderId), filled_avg_price: "106" });
    const drifted = await ex.syncPaper(buy.clientOrderId, broker, now);
    assert.equal(drifted.orderState, "UNKNOWN");
    assert.equal(state.submits.length, 1);
  } finally {
    ex.release();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reject, cancel, and a duplicate submit send the broker one write", async () => {
  const dir = mkdtempSync(join(tmpdir(), "spy-term-"));
  const ex = start(dir);
  const state = book();
  state.mode = "reject";
  const broker = writer(state);
  const buy = instruction({ clientOrderId: "spy-rej", nonce: "spy-rej" });
  try {
    ex.acceptSupervised(buy, now);
    const rejected = await ex.submitPaper(buy, broker, env(), now);
    assert.equal(rejected.orderState, "rejected");
    assert.equal(state.submits.length, 1);
    const again = await ex.submitPaper(buy, broker, env(), now);
    assert.match(again.reason, /duplicate|new approval|not resubmitted/);
    assert.equal(state.submits.length, 1);

    const dir2 = mkdtempSync(join(tmpdir(), "spy-can-"));
    const ex2 = start(dir2);
    const state2 = book();
    state2.mode = "accept";
    const broker2 = writer(state2);
    const working = instruction({ clientOrderId: "spy-work", nonce: "spy-work" });
    ex2.acceptSupervised(working, now);
    assert.equal((await ex2.submitPaper(working, broker2, env(), now)).orderState, "accepted");
    const canceled = await ex2.cancelPaper(working.clientOrderId, broker2, env(), now);
    assert.equal(canceled.orderState, "canceled");
    assert.equal(state2.cancels.length, 1);
    const late = await ex2.submitPaper(working, broker2, env(), now);
    assert.equal(late.submitted, false);
    assert.equal(state2.submits.length, 1);
    ex2.release();
    rmSync(dir2, { recursive: true, force: true });
  } finally {
    ex.release();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ambiguous submit is resolved by GET and is never retried", async () => {
  const foundDir = mkdtempSync(join(tmpdir(), "spy-found-"));
  const found = start(foundDir);
  const foundBook = book();
  foundBook.mode = "ambiguous";
  const foundBroker = writer(foundBook);
  const buy = instruction({ clientOrderId: "spy-found", nonce: "spy-found" });
  try {
    found.acceptSupervised(buy, now);
    const ambiguous = await found.submitPaper(buy, foundBroker, env(), now);
    assert.match(ambiguous.reason, /not retried/);
    assert.equal(ambiguous.orderState, "UNKNOWN");
    assert.equal(foundBook.submits.length, 1);
    foundBook.orders.set(buy.clientOrderId, {
      id: "brk-spy-found", client_order_id: buy.clientOrderId, status: "accepted", filled_qty: "0", symbol: "SPY", side: "buy",
    });
    const recovered = await found.recoverInFlight(foundBroker, now);
    assert.equal(foundBook.submits.length, 1);
    assert.equal(found.get(buy.clientOrderId)?.orderState, "accepted", recovered.reason);
    assert.equal(recovered.resolved, false);
    const retry = await found.submitPaper(buy, foundBroker, env(), now);
    assert.equal(retry.submitted, false);
    assert.equal(foundBook.submits.length, 1);
  } finally {
    found.release();
    rmSync(foundDir, { recursive: true, force: true });
  }

  const goneDir = mkdtempSync(join(tmpdir(), "spy-gone-"));
  const gone = start(goneDir);
  const goneBook = book();
  goneBook.mode = "ambiguous";
  const goneBroker = writer(goneBook);
  const missed = instruction({ clientOrderId: "spy-gone", nonce: "spy-gone" });
  try {
    gone.acceptSupervised(missed, now);
    await gone.submitPaper(missed, goneBroker, env(), now);
    const absent = await gone.recoverInFlight(goneBroker, now);
    assert.equal(absent.resolved, true);
    assert.equal(gone.get(missed.clientOrderId)?.confirmedAbsent, true);
    assert.match(readFileSync(join(goneDir, "journal.jsonl"), "utf8"), /confirmed absent; not resubmitted/);
    assert.equal(goneBook.submits.length, 1);
    const same = await gone.submitPaper(missed, goneBroker, env(), now);
    assert.match(same.reason, /new approval|duplicate|not resubmitted/);
    assert.equal(goneBook.submits.length, 1);
    const fresh = instruction({ clientOrderId: "spy-new", nonce: "spy-new" });
    assert.equal(gone.acceptSupervised(fresh, now).state, "PROPOSED");
    goneBook.mode = "fill";
    assert.equal((await gone.submitPaper(fresh, goneBroker, env(), now)).submitted, true);
    assert.equal(goneBook.submits.length, 2);
  } finally {
    gone.release();
    rmSync(goneDir, { recursive: true, force: true });
  }
});

test("restart after intent, after an unacked submit, and after an ack does not blind-retry", async () => {
  const intentDir = mkdtempSync(join(tmpdir(), "spy-intent-"));
  let intentEx: Executor | null = null;
  try {
    const first = start(intentDir);
    const buy = instruction({ clientOrderId: "spy-intent", nonce: "spy-intent" });
    first.acceptSupervised(buy, now);
    assert.match(readFileSync(join(intentDir, "journal.jsonl"), "utf8"), /spy-intent/);
    const snap = JSON.parse(readFileSync(join(intentDir, "state.json"), "utf8")) as { nonces: string[]; clientOrderIds: string[] };
    snap.nonces = [];
    snap.clientOrderIds = [];
    writeFileSync(join(intentDir, "state.json"), JSON.stringify(snap));
    first.release();
    intentEx = start(intentDir);
    assert.equal(intentEx.acceptSupervised(buy, now).reason, "duplicate or replay");
    assert.equal(intentEx.get(buy.clientOrderId)?.orderState, "intent");
    const state = book();
    const broker = writer(state);
    const recovered = await intentEx.recoverInFlight(broker, now);
    assert.match(recovered.reason, /no in-flight/);
    assert.equal(state.submits.length, 0);
    const polled = await intentEx.runBrokerPoll({
      async request(input: { url: string }) {
        if (input.url.includes("/v2/account")) return { status: 200, body: { status: "ACTIVE", trading_blocked: false } };
        if (input.url.includes("/v2/clock")) return { status: 200, body: { is_open: true } };
        if (input.url.includes("/v2/positions")) return { status: 200, body: [] };
        if (input.url.includes("/quotes/")) return { status: 200, body: { quote: { bp: 100, ap: 100.02, t: new Date(now).toISOString() } } };
        if (input.url.includes("by_client_order_id")) return { status: 404, body: null };
        if (input.url.includes("/v2/orders")) return { status: 200, body: [] };
        return { status: 404, body: null };
      },
    }, now);
    assert.equal(polled.ok, true, polled.failureKind ?? "poll failed");
    assert.equal(intentEx.get(buy.clientOrderId)?.orderState, "intent");
    assert.equal((await intentEx.submitPaper(buy, broker, env(), now)).submitted, true);
    assert.equal(state.submits.length, 1);
  } finally {
    intentEx?.release();
    rmSync(intentDir, { recursive: true, force: true });
  }

  const crashDir = mkdtempSync(join(tmpdir(), "spy-crash-"));
  let crashed: Executor | null = null;
  try {
    const first = start(crashDir);
    const buy = instruction({ clientOrderId: "spy-crash", nonce: "spy-crash" });
    const state = book();
    state.mode = "crash";
    const broker = writer(state);
    first.acceptSupervised(buy, now);
    await assert.rejects(() => first.submitPaper(buy, broker, env(), now), ProcessCrash);
    assert.equal(state.submits.length, 1);
    first.release();
    crashed = start(crashDir);
    assert.equal(crashed.get(buy.clientOrderId)?.orderState, "submitted");
    const nextBook = book();
    const next = writer(nextBook);
    const absent = await crashed.recoverInFlight(next, now);
    assert.equal(absent.resolved, true);
    assert.equal(nextBook.submits.length, 0);
    assert.equal(crashed.get(buy.clientOrderId)?.confirmedAbsent, true);
    assert.equal((await crashed.submitPaper(buy, next, env(), now)).submitted, false);
  } finally {
    crashed?.release();
    rmSync(crashDir, { recursive: true, force: true });
  }

  const ackDir = mkdtempSync(join(tmpdir(), "spy-ack-"));
  let acked: Executor | null = null;
  try {
    const first = start(ackDir);
    const buy = instruction({ clientOrderId: "spy-ack", nonce: "spy-ack" });
    const state = book();
    first.acceptSupervised(buy, now);
    await first.submitPaper(buy, writer(state), env(), now);
    assert.equal(first.get(buy.clientOrderId)?.orderState, "filled");
    first.release();
    acked = start(ackDir);
    assert.equal(acked.get(buy.clientOrderId)?.state, "OPEN");
    const nextBook = book();
    nextBook.orders.set(buy.clientOrderId, { id: "brk-spy-ack", status: "filled", filled_qty: "0.02", filled_avg_price: "100", symbol: "SPY", side: "buy", executions: [] });
    nextBook.positions = [{ symbol: "SPY", qty: "0.02" }];
    await acked.recoverInFlight(writer(nextBook), now);
    assert.equal(nextBook.submits.length, 0);
    assert.notEqual(acked.get(buy.clientOrderId)?.state, "FLAT");
  } finally {
    acked?.release();
    rmSync(ackDir, { recursive: true, force: true });
  }
});

test("each missing gate refuses and a dev flag alone cannot authorize", async () => {
  const dir = mkdtempSync(join(tmpdir(), "spy-gate-"));
  const ex = start(dir);
  const state = book();
  const broker = writer(state);
  const buy = instruction();
  ex.acceptSupervised(buy, now);
  const cases: { name: string; run: () => Promise<string> }[] = [
    { name: "dev flag", run: async () => (await ex.submitPaper(buy, broker, env({ PAPER_POST_ENABLED: undefined, APEX_EXECUTOR_DEV_SUBMIT: "true" }), now)).reason },
    { name: "paper off", run: async () => (await ex.submitPaper(buy, broker, env({ PAPER_POST_ENABLED: undefined }), now)).reason },
    { name: "live url", run: async () => (await ex.submitPaper(buy, broker, env({ APCA_API_BASE_URL: "https://api.alpaca.markets" }), now)).reason },
    { name: "real writer", run: async () => (await ex.submitPaper(buy, ex.realWriter(), env(), now)).reason },
    { name: "sigma", run: async () => (await ex.submitPaper(instruction({ clientOrderId: "spy-sigma", nonce: "spy-sigma" }, undefined, { dataIntegrityOk: false }), broker, env(), now)).reason },
    { name: "sentinel", run: async () => (await ex.submitPaper(instruction({ clientOrderId: "spy-sent", nonce: "spy-sent" }, undefined, { riskOk: false }), broker, env(), now)).reason },
    { name: "strategy", run: async () => (await ex.submitPaper({ ...instruction({ clientOrderId: "spy-strat", nonce: "spy-strat" }), strategyApproved: true as false }, broker, env(), now)).reason },
    { name: "trade category", run: async () => (await ex.submitPaper(instruction({ clientOrderId: "spy-trade", nonce: "spy-trade", category: "STRATEGY_TRADE" }), broker, env(), now)).reason },
    { name: "connectivity", run: async () => (await ex.submitPaper(instruction({ clientOrderId: "spy-conn", nonce: "spy-conn", category: "CONNECTIVITY_TEST" }), broker, env(), now)).reason },
    { name: "notional", run: async () => (await ex.submitPaper(instruction({ clientOrderId: "spy-big", nonce: "spy-big" }, 25.02), broker, env(), now)).reason },
    { name: "qty", run: async () => (await ex.submitPaper(instruction({ clientOrderId: "spy-qty", nonce: "spy-qty", qty: 2, limitPrice: 1 }, 2), broker, env(), now)).reason },
    { name: "stale", run: async () => (await ex.submitPaper(buy, broker, env(), now + 5_001)).reason },
    { name: "closed", run: async () => {
      ex.observeMarket(flatSnapshot(now, { clockOpen: false }), now);
      const reason = (await ex.submitPaper(buy, broker, env(), now)).reason;
      ex.observeMarket(openMarket(now), now);
      return reason;
    } },
  ];
  try {
    for (const item of cases) {
      const reason = await item.run();
      assert.notEqual(reason, "", item.name);
      assert.equal(state.submits.length, 0, `${item.name}: ${reason}`);
    }
    assert.match(cases[0] ? await cases[0].run() : "", /dev flag/);
    const dev = await ex.submitPaper(buy, broker, env({ PAPER_POST_ENABLED: undefined, APEX_EXECUTOR_DEV_SUBMIT: "true" }), now);
    assert.match(dev.reason, /dev flag cannot authorize/);
    const live = await ex.submitPaper(buy, broker, env({ APCA_API_BASE_URL: "https://api.alpaca.markets" }), now);
    assert.match(live.reason, /LIVE URL/);
    const big = await ex.submitPaper(instruction({ clientOrderId: "spy-big-2", nonce: "spy-big-2" }, 25.5), broker, env(), now);
    assert.match(big.reason, /\$25/);
    const closed = await (async () => {
      ex.observeMarket(flatSnapshot(now, { clockOpen: false }), now);
      return ex.submitPaper(buy, broker, env(), now);
    })();
    assert.match(closed.reason, /market closed/);
    ex.observeMarket(openMarket(now), now);
    const stale = await ex.submitPaper(buy, broker, env(), now + 5_001);
    assert.match(stale.reason, /stale/);
    const mismatched = await ex.runBrokerPoll({
      async request(input: { url: string }) {
        if (input.url.includes("/v2/account")) return { status: 200, body: { status: "ACTIVE", trading_blocked: false } };
        if (input.url.includes("/v2/clock")) return { status: 200, body: { is_open: true } };
        if (input.url.includes("/v2/positions")) return { status: 200, body: [] };
        if (input.url.includes("/quotes/")) return { status: 200, body: { quote: { bp: 100, ap: 100.02, t: new Date(now).toISOString() } } };
        if (input.url.includes("by_client_order_id")) return { status: 404, body: null };
        if (input.url.includes("/v2/orders")) return { status: 200, body: [] };
        return { status: 404, body: null };
      },
    }, now);
    assert.equal(mismatched.failureKind, "reconcile");
    const blockedBook = await ex.submitPaper(buy, broker, env(), now);
    assert.match(blockedBook.reason, /reconciliation/);
    ex.release();
    const unlocked = await ex.submitPaper(buy, broker, env(), now);
    assert.match(unlocked.reason, /writer lock/);
    assert.equal(PAPER_POST_ENABLED, false);
    assert.equal(proposedTicket({ verdict: "READY_FOR_OPERATOR_APPROVAL", ...approval({ category: "STRATEGY_TRADE" }) }).ok, false);
  } finally {
    ex.release();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("kill switch blocks a new buy and still allows a signed risk-reducing exit", async () => {
  const dir = mkdtempSync(join(tmpdir(), "spy-kill-"));
  const ex = start(dir);
  const state = book();
  const broker = writer(state);
  const buy = instruction({ clientOrderId: "spy-kill", nonce: "spy-kill" });
  try {
    ex.acceptSupervised(buy, now);
    assert.equal((await ex.submitPaper(buy, broker, env(), now)).orderState, "filled");
    assert.notEqual(ex.get(buy.clientOrderId)?.state, "FLAT");
    ex.engageKillSwitch(now);
    const another = instruction({ clientOrderId: "spy-kill-2", nonce: "spy-kill-2" });
    assert.match(ex.acceptSupervised(another, now).reason, /kill switch/);
    const held = instruction({ clientOrderId: "spy-kill-held", nonce: "spy-kill-held" });
    ex.observeMarket(flatSnapshot(now, {}, []), now);
    assert.match(ex.acceptSupervised(held, now).reason, /kill switch/);
    const sell = instruction({ side: "sell", clientOrderId: "spy-kill-sell", nonce: "spy-kill-sell", qty: 0.02, exitAuthorizationId: "exit-kill", linkedEntryId: buy.clientOrderId });
    const get = async (url: string) => url.includes("/v2/positions") ? { status: 200, body: state.positions } : { status: 200, body: state.open };
    const armed = ex.acceptSupervised(sell, now);
    assert.equal(armed.accepted, true, armed.reason);
    const exited = await ex.submitPaper(sell, broker, env(), now);
    assert.equal(exited.submitted, true);
    assert.equal(ex.get(sell.clientOrderId)?.state, "FLAT");
    assert.equal(ex.get(buy.clientOrderId)?.state, "FLAT");
    assert.deepEqual(state.positions, []);
  } finally {
    ex.release();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("oversell and a pending sell are refused and a short is refused", async () => {
  const dir = mkdtempSync(join(tmpdir(), "spy-over-"));
  const ex = start(dir);
  const state = book();
  const broker = writer(state);
  const buy = instruction({ clientOrderId: "spy-over", nonce: "spy-over" });
  try {
    ex.acceptSupervised(buy, now);
    await ex.submitPaper(buy, broker, env(), now);
    const get = async (url: string) => url.includes("/v2/positions") ? { status: 200, body: state.positions } : { status: 200, body: [] };
    const tooBig = instruction({ side: "sell", clientOrderId: "spy-over-big", nonce: "spy-over-big", qty: 0.03, exitAuthorizationId: "exit-big", linkedEntryId: buy.clientOrderId });
    assert.match((await ex.submitPaper(tooBig, broker, env(), now)).reason, /exceeds/);
    const first = instruction({ side: "sell", clientOrderId: "spy-over-1", nonce: "spy-over-1", qty: 0.01, exitAuthorizationId: "exit-1", linkedEntryId: buy.clientOrderId });
    assert.equal(ex.acceptSupervised(first, now).accepted, true);
    const second = instruction({ side: "sell", clientOrderId: "spy-over-2", nonce: "spy-over-2", qty: 0.02, exitAuthorizationId: "exit-2", linkedEntryId: buy.clientOrderId });
    assert.match((await ex.submitPaper(second, broker, env(), now)).reason, /exceeds/);
    state.positions = [{ symbol: "SPY", qty: "0.005" }];
    const shrunk = await ex.submitPaper(first, broker, env(), now);
    assert.match(shrunk.reason, /exceeds/);
    assert.equal(state.submits.filter((row) => (row as { side?: string }).side === "sell").length, 0);
    const flatBook = book();
    const naked = instruction({ side: "sell", clientOrderId: "spy-short", nonce: "spy-short", qty: 0.01, exitAuthorizationId: "exit-short", linkedEntryId: buy.clientOrderId });
    const empty = async () => ({ status: 200, body: [] });
    assert.match((await ex.submitPaper(naked, broker, env(), now)).reason, /linked|exceeds|symbol/);
  } finally {
    ex.release();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("timeouts, 5xx, and 429 during submit and poll are not retried", async () => {
  const dirs: string[] = [];
  const opened: Executor[] = [];
  try {
    for (const mode of ["throw", "down", "limit"] as const) {
      const dir = mkdtempSync(join(tmpdir(), `spy-${mode}-`));
      dirs.push(dir);
      const ex = start(dir);
      opened.push(ex);
      const state = book();
      state.mode = mode;
      const broker = writer(state);
      const buy = instruction({ clientOrderId: `spy-${mode}`, nonce: `spy-${mode}` });
      assert.equal(ex.acceptSupervised(buy, now).state, "PROPOSED", mode);
      const result = await ex.submitPaper(buy, broker, env(), now);
      assert.equal(result.orderState, "UNKNOWN", `${mode}: ${result.reason}`);
      assert.match(result.reason, /not retried/);
      assert.equal(state.submits.length, 1);
      const second = await ex.submitPaper(buy, broker, env(), now);
      assert.equal(second.submitted, false);
      assert.equal(state.submits.length, 1);
    }
    const ex = opened[0]!;
    const calls: string[] = [];
    const timeout = await ex.runBrokerPoll({
      async request() {
        calls.push("timeout");
        throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
      },
    }, now);
    assert.equal(timeout.failureKind, "timeout");
    const down = await ex.runBrokerPoll({
      async request() {
        calls.push("down");
        return { status: 503, body: null };
      },
    }, now + 1);
    assert.equal(down.failureKind, "http");
    const limited = await ex.runBrokerPoll({
      async request() {
        calls.push("limit");
        return { status: 429, body: null };
      },
    }, now + 2);
    assert.equal(limited.failureKind, "http");
    assert.deepEqual(calls, ["timeout", "down", "limit"]);
  } finally {
    for (const exec of opened) exec.release();
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  }
});

test("a full request budget and the outstanding cap refuse before another write", async () => {
  const dir = mkdtempSync(join(tmpdir(), "spy-budget-"));
  const ex = start(dir);
  const state = book();
  const broker = writer(state);
  const buy = instruction({ clientOrderId: "spy-budget", nonce: "spy-budget" });
  const calls: string[] = [];
  try {
    ex.acceptSupervised(buy, now);
    assert.equal(ex.spendBudget(now, TRADING_API_BUDGET_PER_MIN - 10, "entry"), true);
    assert.equal(ex.spendBudget(now, 1, "entry"), false);
    const polled = await ex.runBrokerPoll({
      async request() {
        calls.push("poll");
        return { status: 500, body: null };
      },
    }, now);
    assert.equal(polled.ok, false);
    assert.deepEqual(calls, []);
    const blocked = await ex.submitPaper(buy, broker, env(), now);
    assert.match(blocked.reason, /budget/);
    assert.equal(state.submits.length, 0);
  } finally {
    ex.release();
    rmSync(dir, { recursive: true, force: true });
  }

  const capDir = mkdtempSync(join(tmpdir(), "spy-cap-"));
  const cap = start(capDir);
  const capBook = book();
  capBook.mode = "accept";
  const capBroker = writer(capBook);
  try {
    const first = instruction({ clientOrderId: "spy-cap-1", nonce: "spy-cap-1" });
    const second = instruction({ clientOrderId: "spy-cap-2", nonce: "spy-cap-2" });
    cap.acceptSupervised(first, now);
    cap.acceptSupervised(second, now);
    assert.equal((await cap.submitPaper(first, capBroker, env(), now)).orderState, "accepted");
    const refused = await cap.submitPaper(second, capBroker, env(), now);
    assert.match(refused.reason, /outstanding/);
    assert.equal(capBook.submits.length, 1);
    assert.equal(cap.health(now).requestBudget.outstandingCap, 1);
  } finally {
    cap.release();
    rmSync(capDir, { recursive: true, force: true });
  }
});

test("explicit zero fees are marked and mock fills stay out of production evidence", async () => {
  const dir = mkdtempSync(join(tmpdir(), "spy-fee-"));
  const ex = start(dir);
  const state = book();
  const broker = writer(state);
  const buy = instruction({ clientOrderId: "spy-fee", nonce: "spy-fee" });
  try {
    ex.acceptSupervised(buy, now);
    await ex.submitPaper(buy, broker, env(), now);
    const event = ex.fillEvents()[0];
    assert.ok(event);
    assert.equal(event.fee, null);
    assert.equal(event.feeKnown, false);
    assert.equal(event.feeSource, "unknown");
    assert.match(hermesPerformanceRefusal(event) ?? "", /test evidence|fee unknown/);
    assert.match(hermesPerformanceRefusal({ ...event, evidenceChannel: "alpaca-http", provenance: "broker", source: "PAPER", venue: "alpaca-paper" }) ?? "", /fee unknown/);
    assert.equal(STRATEGY_APPROVED, false);
  } finally {
    ex.release();
    rmSync(dir, { recursive: true, force: true });
  }
});
