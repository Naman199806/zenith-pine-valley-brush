/**
 * Adverse cases from the PR #8 review.
 * Fake clock, injected broker, no network.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { signApproval, type CanonicalApproval } from "../src/approval.ts";
import { issueGateProof } from "../../../src/lib/apex/live/executor.ts";
import { hermesPerformanceRefusal, type FillEvent } from "../src/fill-event.ts";
import type { TradeInstruction } from "../src/instruction.ts";
import { Executor, openMarket, type ExecutorConfig } from "../src/runtime.ts";
import { brokerBodyMismatch, exactBrokerBody, signSupervisedGate, signSupervisedOrder, type SupervisedOrder } from "../src/supervised-order.ts";
import type { PaperWriter } from "../src/broker-write.ts";

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

function buy(over: { clientOrderId?: string; nonce?: string; notional?: string; expiresAt?: string } = {}): SupervisedOrder {
  const draft = {
    v: 1 as const, source: "OPERATOR_SIGNED" as const, category: "SUPERVISED_PAPER_TEST" as const, symbol: "SPY" as const,
    side: "buy" as const, orderType: "market_notional" as const, timeInForce: "day" as const, extendedHours: false as const,
    notional: over.notional ?? "2.00", clientOrderId: over.clientOrderId ?? "rev-buy", expiresAt: over.expiresAt ?? "2099-01-01T00:00:00Z",
    nonce: over.nonce ?? "rev-buy-nonce", session: "REGULAR" as const, exitAuthorizationId: null, linkedEntryId: null,
    decisionId: "rev", strategyId: "supervised-paper", strategyVersion: "v1", strategyApproved: false as const,
    operatorProof: null, gateProof: null,
  };
  const order = draft as SupervisedOrder;
  order.operatorProof = signSupervisedOrder(order, SECRET);
  order.gateProof = signSupervisedGate(order, GATE, now);
  return order;
}

function sell(entryId: string, over: { clientOrderId?: string; nonce?: string; qty?: string; expiresAt?: string } = {}): SupervisedOrder {
  const draft = {
    v: 1 as const, source: "OPERATOR_SIGNED" as const, category: "SUPERVISED_PAPER_TEST" as const, symbol: "SPY" as const,
    side: "sell" as const, orderType: "market_qty" as const, timeInForce: "day" as const, extendedHours: false as const,
    qty: over.qty ?? "0.02", clientOrderId: over.clientOrderId ?? "rev-sell", expiresAt: over.expiresAt ?? "2099-01-01T00:00:00Z",
    nonce: over.nonce ?? "rev-sell-nonce", session: "REGULAR" as const, exitAuthorizationId: "exit-rev", linkedEntryId: entryId,
    decisionId: "rev", strategyId: "supervised-paper", strategyVersion: "v1", strategyApproved: false as const,
    operatorProof: null, gateProof: null,
  };
  const order = draft as SupervisedOrder;
  order.operatorProof = signSupervisedOrder(order, SECRET);
  order.gateProof = signSupervisedGate(order, GATE, now);
  return order;
}

function alpaca(id: string, status: string, filled: string): Record<string, unknown> {
  return { id: `brk-${id}`, client_order_id: id, status, filled_qty: filled, filled_avg_price: filled === "0" ? null : "100", symbol: "SPY", side: "buy", type: "market", time_in_force: "day", extended_hours: false };
}

function writer(opts?: { onPositions?: () => void; failAfter?: number }): { broker: PaperWriter; submits: object[]; orders: Map<string, Record<string, unknown>>; positions: { symbol: string; qty: string }[] } {
  const orders = new Map<string, Record<string, unknown>>();
  const positions: { symbol: string; qty: string }[] = [];
  const submits: object[] = [];
  let probes = 0;
  const broker: PaperWriter = {
    networkWrite: "injected",
    async submit(order) {
      submits.push(order);
      const row = order as { client_order_id: string; side: string; qty?: string };
      const body = alpaca(row.client_order_id, "filled", row.side === "sell" ? String(row.qty) : "0.02");
      body.side = row.side;
      orders.set(row.client_order_id, body);
      if (row.side === "buy") positions.splice(0, positions.length, { symbol: "SPY", qty: "0.02" });
      else positions.splice(0, positions.length);
      return { kind: "ack", status: 200, body };
    },
    async cancel() { return { kind: "ack", status: 200, body: {} }; },
    async getOrder(id) {
      probes += 1;
      if (opts?.failAfter != null && probes > opts.failAfter) return { status: 503, body: null };
      const row = orders.get(id);
      return row ? { status: 200, body: row } : { status: 404, body: null };
    },
    async getPositions() {
      opts?.onPositions?.();
      return { status: 200, body: positions };
    },
    async getOpenOrders() { return { status: 200, body: [] }; },
    async listOrders() { return { status: 200, body: [...orders.values()] }; },
    async listFills() { return { status: 200, body: [] }; },
  };
  return { broker, submits, orders, positions };
}

test("a limit ticket is not converted and a tampered notional does not match the signature", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rev-limit-"));
  const ex = start(dir);
  const { broker, submits } = writer();
  const base: CanonicalApproval = {
    v: 1, source: "OPERATOR_SIGNED", clientOrderId: "limit-1", symbol: "SPY", side: "buy", orderType: "limit",
    timeInForce: "day", qty: 0.02, limitPrice: 100, session: "REGULAR", expiresAt: "2099-01-01T00:00:00Z", nonce: "limit-nonce",
    category: "CONNECTIVITY_TEST", exitAuthorizationId: null, linkedEntryId: null,
  };
  const gate = issueGateProof({ singleUseId: base.clientOrderId, symbol: "SPY", side: "buy", qty: 0.02, limitPrice: 100 }, { dataIntegrityOk: true, riskOk: true, notional: 2 }, new Date(now), GATE);
  const ticket: TradeInstruction = { ...base, decisionId: "d", strategyId: "s", strategyVersion: "v1", strategyApproved: false, evidenceTimestamp: new Date(now).toISOString(), sizedNotional: 2, operatorProof: signApproval(base, SECRET), gateProof: gate };
  const signed = buy();
  const changed = { ...signed, notional: "2.01" };
  try {
    assert.match((await ex.submitPaper(ticket, broker, env(), now)).reason, /cannot be converted/);
    assert.match((await ex.submitPaper(changed, broker, env(), now)).reason, /proof mismatch|not bound/);
    assert.equal(brokerBodyMismatch(signed, { ...exactBrokerBody(signed), notional: "2" }), "broker body notional does not match the signed order");
    assert.equal(submits.length, 0);
  } finally {
    ex.release();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("one 404 after a timeout is not absence and the unknown id blocks every new id across restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rev-404-"));
  let ex = start(dir);
  const { broker, submits, orders } = writer({ failAfter: 1 });
  const first = buy();
  try {
    ex.acceptSupervised(first, now);
    const hung = writer();
    hung.broker.submit = async () => ({ kind: "ambiguous", reason: "timeout" });
    assert.equal((await ex.submitPaper(first, hung.broker, env(), now)).orderState, "UNKNOWN");
    const recovered = await ex.recoverInFlight(broker, now, async () => {});
    assert.match(recovered.reason, /without sufficient evidence/);
    assert.notEqual(ex.get(first.clientOrderId)?.confirmedAbsent, true);
    assert.notEqual(ex.get(first.clientOrderId)?.orderState, "canceled");
    assert.equal(ex.get(first.clientOrderId)?.orderState, "UNKNOWN");
    const replacement = buy({ clientOrderId: "rev-other", nonce: "rev-other" });
    assert.match((await ex.submitPaper(replacement, broker, env(), now)).reason, /UNKNOWN|in-flight/);
    assert.equal(submits.length, 0);
    assert.equal(orders.size, 0);
    ex.release();
    ex = start(dir);
    assert.equal(ex.get(first.clientOrderId)?.orderState, "UNKNOWN");
    assert.ok(ex.health(now).unknownClientOrderIds.includes(first.clientOrderId));
    assert.match((await ex.submitPaper(replacement, broker, env(), now)).reason, /UNKNOWN|stale|replay|in-flight/);
    assert.equal(broker.submit === hung.broker.submit, false);
  } finally {
    ex.release();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("exit replay after restart, a missing link, and the wrong symbol are refused", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rev-exit-"));
  let ex = start(dir);
  const { broker } = writer();
  const entry = buy({ clientOrderId: "rev-entry", nonce: "rev-entry" });
  try {
    ex.acceptSupervised(entry, now);
    await ex.submitPaper(entry, broker, env(), now);
    const exit = sell(entry.clientOrderId);
    assert.equal(ex.acceptSupervised(exit, now).accepted, true);
    const qqq: CanonicalApproval = {
      v: 1, source: "OPERATOR_SIGNED", clientOrderId: "qqq-buy", symbol: "QQQ", side: "buy", orderType: "limit",
      timeInForce: "day", qty: 0.02, limitPrice: 100, session: "REGULAR", expiresAt: "2099-01-01T00:00:00Z", nonce: "qqq-nonce",
      category: "CONNECTIVITY_TEST", exitAuthorizationId: null, linkedEntryId: null,
    };
    const qqqGate = issueGateProof({ singleUseId: "qqq-buy", symbol: "QQQ", side: "buy", qty: 0.02, limitPrice: 100 }, { dataIntegrityOk: true, riskOk: true, notional: 2 }, new Date(now), GATE);
    assert.equal(ex.accept({ ...qqq, decisionId: "d", strategyId: "s", strategyVersion: "v1", strategyApproved: false, evidenceTimestamp: new Date(now).toISOString(), sizedNotional: 2, operatorProof: signApproval(qqq, SECRET), gateProof: qqqGate }, now).state, "PROPOSED");
    await ex.reconcile(async (url) => {
      if (url.includes("by_client")) return { status: 200, body: { filled_qty: "0.02", status: "filled", symbol: "QQQ", side: "buy" } };
      if (url.includes("/v2/positions")) return { status: 200, body: [{ symbol: "QQQ", qty: "0.02" }] };
      return { status: 200, body: [] };
    }, "qqq-buy");
    const wrong = sell("qqq-buy", { clientOrderId: "rev-wrong", nonce: "rev-wrong" });
    assert.match(ex.acceptSupervised(wrong, now).reason, /symbol/);
    ex.release();
    ex = start(dir);
    assert.equal(ex.acceptSupervised(exit, now).reason, "duplicate or replay");
    const unlinked = sell("not-a-journaled-entry", { clientOrderId: "rev-unlinked", nonce: "rev-unlinked" });
    assert.match(ex.acceptSupervised(unlinked, now).reason, /linked/);
  } finally {
    ex.release();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("freshness and expiry are rechecked after the position read and before the write", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rev-toctou-"));
  const ex = start(dir);
  let t = now;
  const { broker, submits, positions } = writer({ onPositions() { t = now + 6_000; } });
  const entry = buy({ clientOrderId: "rev-fresh", nonce: "rev-fresh" });
  try {
    ex.acceptSupervised(entry, now);
    await ex.submitPaper(entry, broker, env(), now);
    const exit = sell(entry.clientOrderId, { expiresAt: new Date(now + 1_000).toISOString(), clientOrderId: "rev-fresh-sell", nonce: "rev-fresh-sell" });
    ex.acceptSupervised(exit, () => t);
    t = now;
    const refused = await ex.submitPaper(exit, broker, env(), () => t);
    assert.match(refused.reason, /stale|expired/);
    assert.equal(submits.filter((row) => (row as { side?: string }).side === "sell").length, 0);
    assert.equal(positions[0]?.qty, "0.02");
  } finally {
    ex.release();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("entries cannot spend the reserve and stale evidence refuses while budget remains", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rev-reserve-"));
  const ex = start(dir);
  const { broker, submits } = writer();
  const entry = buy({ clientOrderId: "rev-reserve", nonce: "rev-reserve" });
  try {
    ex.acceptSupervised(entry, now);
    assert.equal(ex.spendBudget(now, 140, "entry"), true);
    const blocked = await ex.submitPaper(entry, broker, env(), now);
    assert.match(blocked.reason, /budget/);
    assert.equal(ex.spendBudget(now, 1, "recovery"), true);
    assert.equal(submits.length, 0);
    const staleDir = mkdtempSync(join(tmpdir(), "rev-stale-"));
    const stale = start(staleDir);
    const staleBook = writer();
    const staleBuy = buy({ clientOrderId: "rev-stale", nonce: "rev-stale" });
    stale.acceptSupervised(staleBuy, now);
    const late = await stale.submitPaper(staleBuy, staleBook.broker, env(), now + 5_001);
    assert.match(late.reason, /stale/);
    assert.equal(staleBook.submits.length, 0);
    assert.equal(stale.health(now + 5_001).requestBudget.used < 140, true);
    stale.release();
    rmSync(staleDir, { recursive: true, force: true });
  } finally {
    ex.release();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an injected fill with an unknown fee cannot enter the Hermes performance sink", () => {
  const event = {
    v: 1, status: "COMPLETE", decisionId: "d", strategyVersion: "v1", clientOrderId: "c", brokerOrderId: "b", fillId: "f",
    symbol: "SPY", side: "buy", qty: 0.02, fillPrice: 100, intendedPrice: 100, fee: null, feeKnown: false, feeSource: "unknown",
    venue: "mock", source: "MOCK", eventTimestamp: "2026-11-16T15:01:00.000Z", at: "2026-11-16T15:01:00.000Z",
    provenance: "injected", evidenceChannel: "injected",
  } as FillEvent;
  assert.match(hermesPerformanceRefusal(event) ?? "", /test evidence/);
  assert.match(hermesPerformanceRefusal({ ...event, evidenceChannel: "alpaca-http", provenance: "broker", source: "PAPER", venue: "alpaca-paper" }) ?? "", /fee unknown/);
});
