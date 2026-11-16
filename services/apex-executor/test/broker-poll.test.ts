/**
 * Broker-poll telemetry. Fake clock, fake GET client, no network, no live keys.
 * A full success is snapshot acquisition plus outstanding-order reconciliation.
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { issueGateProof } from "../../../src/lib/apex/live/executor.ts";
import { signApproval, type CanonicalApproval } from "../src/approval.ts";
import { createPaperPollClient, type BrokerPollClient } from "../src/broker.ts";
import { BROKER_POLL_INTERVAL_MS, classifyHttpStatus, effectiveStaleAfterMs, readPollIntervalMs, readStaleAfterMs } from "../src/broker-poll.ts";
import { PollScheduler, nextPollDelay, type PollTimer } from "../src/runtime.ts";
import type { TradeInstruction } from "../src/instruction.ts";
import { createExecutorServer } from "../src/main.ts";
import {
  Executor,
  LIVE_POST_ENABLED,
  PAPER_POST_ENABLED,
  POST_ENABLED,
  STRATEGY_APPROVED,
  type ExecutorConfig,
} from "../src/runtime.ts";

const SECRET = "operator-secret-32-characters-min";
const GATE = "gate-secret-value-32-characters-ok";
const T0 = Date.parse("2026-11-16T15:00:00Z");
process.env.APEX_OPERATOR_SECRET = SECRET;
process.env.APEX_GATE_SECRET = GATE;

interface Call {
  method: string;
  url: string;
}

interface Book {
  httpStatus?: number;
  throwKind?: "network" | "timeout";
  positions: { symbol: string; qty: string }[];
  open: unknown[];
  orders: Record<string, unknown>;
  poison?: Record<string, unknown>;
  positionsBody?: unknown;
}

function emptyBook(): Book {
  return { positions: [], open: [], orders: {} };
}

function paths(dir: string, staleAfterMs = 1_000): ExecutorConfig {
  return {
    mode: "PAPER",
    postEnabled: false,
    liveCredentialsLoaded: false,
    staleAfterMs,
    statePath: join(dir, "state.json"),
    lockPath: join(dir, "writer.lock"),
    inboxPath: join(dir, "inbox.jsonl"),
    journalPath: join(dir, "journal.jsonl"),
    hermesPath: join(dir, "hermes.json"),
    fillsPath: join(dir, "fills.jsonl"),
  };
}

function approval(over: Partial<CanonicalApproval> = {}): CanonicalApproval {
  return {
    v: 1,
    source: "OPERATOR_SIGNED",
    clientOrderId: "poll-buy",
    symbol: "SPY",
    side: "buy",
    orderType: "limit",
    timeInForce: "day",
    qty: 0.01,
    limitPrice: 1,
    session: "REGULAR",
    expiresAt: "2099-01-01T00:00:00Z",
    nonce: "poll-nonce",
    category: "CONNECTIVITY_TEST",
    exitAuthorizationId: null,
    linkedEntryId: null,
    ...over,
  };
}

function signed(over: Partial<CanonicalApproval> = {}): TradeInstruction {
  const base = approval(over);
  const gate = issueGateProof(
    { singleUseId: base.clientOrderId, symbol: base.symbol, side: base.side, qty: base.qty, limitPrice: base.limitPrice },
    { dataIntegrityOk: true, riskOk: true, notional: Math.min(base.qty * base.limitPrice, 24) },
    new Date(T0),
    GATE,
  );
  if (!gate) throw new Error("test gate proof was not issued");
  return {
    ...base,
    decisionId: "d-poll",
    strategyId: "connectivity",
    strategyVersion: "v1",
    strategyApproved: false,
    evidenceTimestamp: new Date(T0).toISOString(),
    sizedNotional: base.qty * base.limitPrice,
    operatorProof: signApproval(base, SECRET),
    gateProof: gate,
  };
}

function respond(book: Book, now: number, url: string): { status: number; body: unknown } {
  if (book.httpStatus != null) return { status: book.httpStatus, body: book.poison ?? { message: "rejected" } };
  if (url.includes("/v2/account")) {
    return { status: 200, body: { status: "ACTIVE", trading_blocked: false, ...(book.poison ?? {}) } };
  }
  if (url.includes("/v2/clock")) return { status: 200, body: { is_open: true } };
  if (url.includes("/v2/positions")) return { status: 200, body: book.positionsBody ?? book.positions };
  if (url.includes("/quotes/")) {
    return { status: 200, body: { quote: { bp: 100, ap: 100.02, t: new Date(now).toISOString() } } };
  }
  if (url.includes("by_client_order_id")) {
    const id = new URL(url).searchParams.get("client_order_id") ?? "";
    const row = book.orders[id];
    return row ? { status: 200, body: row } : { status: 404, body: null };
  }
  if (url.includes("/v2/orders")) return { status: 200, body: book.open };
  return { status: 404, body: { message: "unexpected" } };
}

function client(calls: Call[], book: Book, now: number): BrokerPollClient {
  return {
    async request(input) {
      calls.push({ method: input.method, url: input.url });
      if (book.throwKind === "network") throw Object.assign(new TypeError("fetch failed"), { code: "ECONNRESET" });
      if (book.throwKind === "timeout") throw Object.assign(new Error("poll timed out"), { name: "TimeoutError", code: "ETIMEDOUT" });
      return respond(book, now, input.url);
    },
  };
}

function assertGetOnly(calls: Call[]): void {
  assert.ok(calls.length > 0);
  assert.deepEqual([...new Set(calls.map((call) => call.method))].sort(), ["GET"]);
}

function open(dir: string, staleAfterMs = 1_000): Executor {
  return new Executor(paths(dir, staleAfterMs), { keyId: "PKTESTKEY1", secret: "paper-secret" });
}

test("initial poll is stale until snapshot and reconciliation both succeed", async () => {
  assert.equal(readStaleAfterMs({}), 5_000);
  assert.equal(effectiveStaleAfterMs(9_000), 5_000);
  assert.throws(() => readStaleAfterMs({ APEX_EXECUTOR_STALE_AFTER_MS: "0" }), /positive integer/);
  const dir = mkdtempSync(join(tmpdir(), "poll-init-"));
  const ex = open(dir);
  try {
    const before = ex.health(T0);
    assert.equal(before.ready, false);
    assert.equal(before.brokerPoll.stale, true);
    assert.equal(before.brokerPoll.freshnessMs, null);
    assert.equal(before.brokerPoll.consecutiveFailures, 0);
    assert.equal(before.brokerPoll.lastFailureKind, null);
    assert.equal(before.brokerPoll.lastAttemptAt, null);
    assert.equal(before.brokerPoll.lastSnapshotOkAt, null);
    assert.equal(before.brokerPoll.lastReconcileOkAt, null);
    assert.equal(before.brokerPoll.lastFullSuccessAt, null);
    assert.equal(before.brokerPoll.staleAfterMs, 1_000);
    assert.deepEqual(before.brokerPoll.reconciliation, { outcome: "NOT_RUN", outstandingOrders: 0, unknownOrders: 0 });
    assert.equal(ex.accept(signed(), T0).accepted, false);

    const calls: Call[] = [];
    const result = await ex.runBrokerPoll(client(calls, emptyBook(), T0), T0);
    assert.equal(result.ok, true);
    assert.equal(result.failureKind, null);
    const health = ex.health(T0);
    const iso = new Date(T0).toISOString();
    assert.equal(health.ready, true);
    assert.equal(health.brokerPoll.stale, false);
    assert.equal(health.brokerPoll.freshnessMs, 0);
    assert.equal(health.brokerPoll.consecutiveFailures, 0);
    assert.equal(health.brokerPoll.lastAttemptAt, iso);
    assert.equal(health.brokerPoll.lastSnapshotOkAt, iso);
    assert.equal(health.brokerPoll.lastReconcileOkAt, iso);
    assert.equal(health.brokerPoll.lastFullSuccessAt, iso);
    assert.equal(health.brokerPoll.reconciliation.outcome, "OK");
    assert.equal(health.brokerPoll.reconciliation.outstandingOrders, 0);
    assert.equal(health.brokerPoll.reconciliation.unknownOrders, 0);
    assert.equal(health.strategyApproved, false);
    assert.equal(health.postEnabled, false);
    assert.equal(ex.accept(signed({ clientOrderId: "poll-open", nonce: "poll-open" }), T0).state, "PROPOSED");
    assertGetOnly(calls);

    const liveDir = mkdtempSync(join(tmpdir(), "poll-http-"));
    const live = open(liveDir, 5_000);
    const httpCalls: Call[] = [];
    const clock = Date.now();
    await live.runBrokerPoll(client(httpCalls, emptyBook(), clock), clock);
    const server = createExecutorServer(live, "health-token");
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    try {
      const denied = await fetch(`http://127.0.0.1:${port}/health`);
      assert.equal(denied.status, 401);
      const res = await fetch(`http://127.0.0.1:${port}/health`, { headers: { "x-executor-token": "health-token" } });
      const body = await res.json() as { ready: boolean; strategyApproved: boolean; paperPost: string; livePost: string; postEnabled: boolean; brokerPoll: { stale: boolean; reconciliation: { outcome: string } } };
      assert.equal(res.status, 200);
      assert.equal(body.paperPost, "DISABLED");
      assert.equal(body.livePost, "DISABLED");
      assert.equal(body.strategyApproved, false);
      assert.equal(body.postEnabled, false);
      assert.equal(body.ready, true);
      assert.equal(body.brokerPoll.stale, false);
      assert.equal(body.brokerPoll.reconciliation.outcome, "OK");
      assert.equal(JSON.stringify(body).includes("paper-secret"), false);
    } finally {
      server.close();
      live.release();
      rmSync(liveDir, { recursive: true, force: true });
    }
  } finally {
    ex.release();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("repeated polls advance broker timestamps monotonically", async () => {
  const dir = mkdtempSync(join(tmpdir(), "poll-mono-"));
  const ex = open(dir);
  const calls: Call[] = [];
  try {
    const times = [T0, T0 + 1_000, T0 + 2_000];
    const stamps: number[] = [];
    for (const now of times) {
      const result = await ex.runBrokerPoll(client(calls, emptyBook(), now), now);
      assert.equal(result.ok, true);
      const poll = ex.health(now).brokerPoll;
      assert.equal(poll.stale, false);
      assert.equal(poll.consecutiveFailures, 0);
      assert.equal(poll.reconciliation.outcome, "OK");
      const fields = [poll.lastAttemptAt, poll.lastSnapshotOkAt, poll.lastReconcileOkAt, poll.lastFullSuccessAt];
      assert.deepEqual(fields, fields.map(() => new Date(now).toISOString()));
      stamps.push(Date.parse(poll.lastFullSuccessAt ?? ""));
    }
    assert.ok(stamps[1]! > stamps[0]!);
    assert.ok(stamps[2]! > stamps[1]!);
    assertGetOnly(calls);
  } finally {
    ex.release();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("auth, network, and timeout failures keep the last full success until it is stale", async () => {
  assert.equal(classifyHttpStatus(401), "auth");
  assert.equal(classifyHttpStatus(403), "auth");
  const dir = mkdtempSync(join(tmpdir(), "poll-fail-"));
  const ex = open(dir);
  const calls: Call[] = [];
  try {
    assert.equal((await ex.runBrokerPoll(client(calls, emptyBook(), T0), T0)).ok, true);
    const full = ex.health(T0).brokerPoll.lastFullSuccessAt;
    const snapshot = ex.health(T0).brokerPoll.lastSnapshotOkAt;
    const cases: { at: number; book: Book; kind: string }[] = [
      { at: T0 + 100, book: { ...emptyBook(), httpStatus: 401 }, kind: "auth" },
      { at: T0 + 200, book: { ...emptyBook(), httpStatus: 403 }, kind: "auth" },
      { at: T0 + 300, book: { ...emptyBook(), throwKind: "network" }, kind: "network" },
      { at: T0 + 400, book: { ...emptyBook(), throwKind: "timeout" }, kind: "timeout" },
      { at: T0 + 500, book: { ...emptyBook(), httpStatus: 500 }, kind: "http" },
      { at: T0 + 600, book: { ...emptyBook(), positionsBody: { bad: true } }, kind: "parse" },
    ];
    for (const [index, item] of cases.entries()) {
      const result = await ex.runBrokerPoll(client(calls, item.book, item.at), item.at);
      assert.equal(result.ok, false);
      assert.equal(result.failureKind, item.kind);
      const poll = ex.health(item.at).brokerPoll;
      assert.equal(poll.lastFailureKind, item.kind);
      assert.equal(poll.consecutiveFailures, index + 1);
      assert.equal(poll.lastFullSuccessAt, full);
      assert.equal(poll.lastSnapshotOkAt, snapshot);
      assert.equal(poll.lastFailureAt, new Date(item.at).toISOString());
      assert.equal(poll.stale, false);
    }
    assert.equal(ex.health(T0 + 700).ready, true);
    assert.equal(ex.accept(signed({ clientOrderId: "poll-grace", nonce: "poll-grace" }), T0 + 700).state, "PROPOSED");
    const stale = ex.health(T0 + 1_001);
    assert.equal(stale.brokerPoll.stale, true);
    assert.equal(stale.ready, false);
    assert.equal(stale.brokerPoll.lastFullSuccessAt, full);
    const refused = ex.accept(signed({ clientOrderId: "poll-late", nonce: "poll-late" }), T0 + 1_001);
    assert.equal(refused.accepted, false);
    assert.match(refused.reason, /stale broker evidence/);
    assertGetOnly(calls);
  } finally {
    ex.release();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a quiet clock past staleAfterMs refuses execution", async () => {
  const dir = mkdtempSync(join(tmpdir(), "poll-stale-"));
  const ex = open(dir);
  const calls: Call[] = [];
  try {
    await ex.runBrokerPoll(client(calls, emptyBook(), T0), T0);
    assert.equal(ex.health(T0 + 500).brokerPoll.stale, false);
    assert.equal(ex.health(T0 + 500).ready, true);
    const health = ex.health(T0 + 1_001);
    assert.equal(health.brokerPoll.stale, true);
    assert.equal(health.brokerPoll.freshnessMs, 1_001);
    assert.equal(health.ready, false);
    assert.equal(health.brokerPoll.reconciliation.outcome, "OK");
    const refused = ex.accept(signed({ clientOrderId: "poll-quiet", nonce: "poll-quiet" }), T0 + 1_001);
    assert.equal(refused.accepted, false);
    assert.match(refused.reason, /stale broker evidence/);
    assertGetOnly(calls);
  } finally {
    ex.release();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a later full success clears consecutive failures and staleness", async () => {
  const dir = mkdtempSync(join(tmpdir(), "poll-recover-"));
  const ex = open(dir);
  const calls: Call[] = [];
  try {
    await ex.runBrokerPoll(client(calls, emptyBook(), T0), T0);
    await ex.runBrokerPoll(client(calls, { ...emptyBook(), httpStatus: 401 }, T0 + 100), T0 + 100);
    await ex.runBrokerPoll(client(calls, { ...emptyBook(), throwKind: "network" }, T0 + 200), T0 + 200);
    assert.equal(ex.health(T0 + 1_001).brokerPoll.consecutiveFailures, 2);
    assert.equal(ex.health(T0 + 1_001).brokerPoll.stale, true);
    assert.equal(ex.health(T0 + 1_001).ready, false);
    const recovered = await ex.runBrokerPoll(client(calls, emptyBook(), T0 + 1_001), T0 + 1_001);
    assert.equal(recovered.ok, true);
    const health = ex.health(T0 + 1_001);
    assert.equal(health.brokerPoll.consecutiveFailures, 0);
    assert.equal(health.brokerPoll.stale, false);
    assert.equal(health.brokerPoll.lastFullSuccessAt, new Date(T0 + 1_001).toISOString());
    assert.equal(health.brokerPoll.reconciliation.outcome, "OK");
    assert.equal(health.ready, true);
    assertGetOnly(calls);
  } finally {
    ex.release();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("snapshot success without reconciliation does not authorize and never marks an unknown order flat", async () => {
  const unknownDir = mkdtempSync(join(tmpdir(), "poll-unknown-"));
  const unknown = open(unknownDir);
  const unknownCalls: Call[] = [];
  try {
    await unknown.runBrokerPoll(client(unknownCalls, emptyBook(), T0), T0);
    const full = unknown.health(T0).brokerPoll.lastFullSuccessAt;
    const book = emptyBook();
    book.open = [{ id: "brk-unknown", client_order_id: "broker-only-order", symbol: "SPY", side: "buy", status: "new", filled_qty: "0" }];
    const result = await unknown.runBrokerPoll(client(unknownCalls, book, T0 + 100), T0 + 100);
    assert.equal(result.ok, false);
    assert.equal(result.failureKind, "reconcile");
    const health = unknown.health(T0 + 100);
    assert.equal(health.brokerPoll.lastSnapshotOkAt, new Date(T0 + 100).toISOString());
    assert.equal(health.brokerPoll.lastFullSuccessAt, full);
    assert.equal(health.brokerPoll.reconciliation.outcome, "UNKNOWN_ORDERS");
    assert.equal(health.brokerPoll.reconciliation.unknownOrders, 1);
    assert.equal(health.ready, false);
    assert.equal(unknown.get("broker-only-order"), undefined);
    const stored = JSON.parse(readFileSync(join(unknownDir, "state.json"), "utf8")) as { records: { clientOrderId: string; state: string }[] };
    assert.equal(stored.records.some((rec) => rec.clientOrderId === "broker-only-order" || rec.state === "FLAT"), false);
    const refused = unknown.accept(signed({ clientOrderId: "poll-after-unknown", nonce: "poll-after-unknown" }), T0 + 100);
    assert.equal(refused.accepted, false);
    assert.match(refused.reason, /reconciliation/);
    const journalPath = join(unknownDir, "journal.jsonl");
    if (existsSync(journalPath)) {
      const journal = readFileSync(journalPath, "utf8");
      assert.equal(journal.includes("broker-only-order"), false);
      assert.equal(journal.includes("\"state\":\"FLAT\""), false);
    }
    assertGetOnly(unknownCalls);
  } finally {
    unknown.release();
    rmSync(unknownDir, { recursive: true, force: true });
  }

  const missingDir = mkdtempSync(join(tmpdir(), "poll-missing-"));
  const missing = open(missingDir);
  const missingCalls: Call[] = [];
  try {
    await missing.runBrokerPoll(client(missingCalls, emptyBook(), T0), T0);
    const full = missing.health(T0).brokerPoll.lastFullSuccessAt;
    assert.equal(missing.accept(signed({ clientOrderId: "poll-proposed", nonce: "poll-proposed" }), T0).state, "PROPOSED");
    const result = await missing.runBrokerPoll(client(missingCalls, emptyBook(), T0 + 100), T0 + 100);
    assert.equal(result.failureKind, "reconcile");
    assert.equal(missing.get("poll-proposed")?.state, "PROPOSED");
    assert.notEqual(missing.get("poll-proposed")?.state, "FLAT");
    const health = missing.health(T0 + 100);
    assert.equal(health.brokerPoll.lastSnapshotOkAt, new Date(T0 + 100).toISOString());
    assert.equal(health.brokerPoll.lastFullSuccessAt, full);
    assert.equal(health.brokerPoll.reconciliation.outcome, "MISMATCH");
    assert.equal(health.ready, false);
    assert.match(missing.accept(signed({ clientOrderId: "poll-more", nonce: "poll-more" }), T0 + 100).reason, /reconciliation/);
    assertGetOnly(missingCalls);
  } finally {
    missing.release();
    rmSync(missingDir, { recursive: true, force: true });
  }

  const attemptDir = mkdtempSync(join(tmpdir(), "poll-attempt-"));
  const attempt = open(attemptDir);
  const attemptCalls: Call[] = [];
  try {
    await attempt.runBrokerPoll(client(attemptCalls, emptyBook(), T0), T0);
    const full = attempt.health(T0).brokerPoll.lastFullSuccessAt;
    assert.equal(attempt.accept(signed({ clientOrderId: "poll-attempted", nonce: "poll-attempted" }), T0).state, "PROPOSED");
    attempt.noteUnconfirmedAttempt("poll-attempted");
    await attempt.runBrokerPoll(client(attemptCalls, emptyBook(), T0 + 100), T0 + 100);
    assert.equal(attempt.get("poll-attempted")?.state, "UNKNOWN");
    assert.notEqual(attempt.get("poll-attempted")?.state, "FLAT");
    const health = attempt.health(T0 + 100);
    assert.equal(health.brokerPoll.lastFullSuccessAt, full);
    assert.ok(Date.parse(health.brokerPoll.lastSnapshotOkAt ?? "") > Date.parse(full ?? ""));
    assert.equal(health.brokerPoll.reconciliation.outcome, "MISMATCH");
    assert.equal(health.ready, false);
    assertGetOnly(attemptCalls);
  } finally {
    attempt.release();
    rmSync(attemptDir, { recursive: true, force: true });
  }
});

test("restart stays stale, then reconciles outstanding orders under the single writer lock", async () => {
  const dir = mkdtempSync(join(tmpdir(), "poll-restart-"));
  const creds = { keyId: "PKTESTKEY1", secret: "paper-secret" };
  const first = new Executor(paths(dir, 5_000), creds);
  const calls: Call[] = [];
  let second: Executor | null = null;
  try {
    await first.runBrokerPoll(client(calls, emptyBook(), T0), T0);
    assert.equal(first.accept(signed({ clientOrderId: "restart-buy", nonce: "restart-buy", qty: 0.02 }), T0).state, "PROPOSED");
    const book = emptyBook();
    book.positions = [{ symbol: "SPY", qty: "0.02" }];
    book.orders["restart-buy"] = { id: "brk-restart", client_order_id: "restart-buy", symbol: "SPY", side: "buy", status: "filled", filled_qty: "0.02" };
    const filled = await first.runBrokerPoll(client(calls, book, T0 + 1_000), T0 + 1_000);
    assert.equal(filled.ok, true);
    assert.equal(first.get("restart-buy")?.state, "OPEN");
    await first.runBrokerPoll(client(calls, { ...emptyBook(), httpStatus: 401 }, T0 + 1_100), T0 + 1_100);
    const disk = JSON.parse(readFileSync(join(dir, "state.json"), "utf8")) as { brokerPoll: { lastFullSuccessAt: string; consecutiveFailures: number; lastFailureKind: string } };
    assert.equal(typeof disk.brokerPoll.lastFullSuccessAt, "string");
    assert.equal(disk.brokerPoll.consecutiveFailures, 1);
    assert.equal(disk.brokerPoll.lastFailureKind, "auth");
    first.release();
    second = new Executor(paths(dir, 5_000), creds);
    const started = second.health(T0 + 1_100);
    assert.equal(started.brokerPoll.stale, true);
    assert.equal(started.ready, false);
    assert.equal(started.brokerPoll.lastFullSuccessAt, null);
    assert.equal(started.brokerPoll.freshnessMs, null);
    assert.equal(started.brokerPoll.reconciliation.outcome, "NOT_RUN");
    assert.equal(started.brokerPoll.reconciliation.outstandingOrders, 1);
    assert.equal(started.brokerPoll.consecutiveFailures, 1);
    assert.equal(started.brokerPoll.lastFailureKind, "auth");
    assert.equal(second.get("restart-buy")?.state, "OPEN");
    assert.equal(second.accept(signed({ clientOrderId: "restart-new", nonce: "restart-new" }), T0 + 1_100).accepted, false);
    assert.throws(() => new Executor(paths(dir, 5_000), creds), /one active writer/);
    const again = await second.runBrokerPoll(client(calls, book, T0 + 2_000), T0 + 2_000);
    assert.equal(again.ok, true);
    const done = second.health(T0 + 2_000);
    assert.equal(done.brokerPoll.stale, false);
    assert.equal(done.ready, true);
    assert.equal(done.brokerPoll.reconciliation.outcome, "OK");
    assert.equal(done.brokerPoll.consecutiveFailures, 0);
    assert.equal(done.brokerPoll.lastFullSuccessAt, new Date(T0 + 2_000).toISOString());
    assert.equal(second.get("restart-buy")?.state, "OPEN");
    assert.notEqual(second.get("restart-buy")?.state, "FLAT");
    assertGetOnly(calls);
  } finally {
    second?.release();
    rmSync(dir, { recursive: true, force: true });
  }

  const bad = mkdtempSync(join(tmpdir(), "poll-corrupt-"));
  try {
    writeFileSync(join(bad, "state.json"), JSON.stringify({
      nonces: [],
      clientOrderIds: [],
      records: [],
      brokerPoll: { lastFailureKind: "raw broker body", consecutiveFailures: 1 },
    }));
    assert.throws(() => new Executor(paths(bad), creds), /corrupt/);
  } finally {
    rmSync(bad, { recursive: true, force: true });
  }
});

test("health, logs, journal, and telemetry never contain credential sentinels", async () => {
  const key = "PKSENTINEL_KEY_DO_NOT_LEAK_001";
  const secret = "SENTINEL_SECRET_DO_NOT_LEAK_002";
  const account = "ACCT_SENTINEL_DO_NOT_LEAK_003";
  const sentinels = [key, secret, account];
  const dir = mkdtempSync(join(tmpdir(), "poll-secret-"));
  const logs: string[] = [];
  const methods = ["log", "info", "warn", "error", "debug"] as const;
  const original = Object.fromEntries(methods.map((method) => [method, console[method]])) as Record<(typeof methods)[number], (...args: unknown[]) => void>;
  for (const method of methods) {
    console[method] = (...args: unknown[]) => {
      logs.push(args.map((item) => String(item)).join(" "));
    };
  }
  const ex = new Executor(paths(dir), { keyId: key, secret });
  const calls: Call[] = [];
  try {
    const poisoned = emptyBook();
    poisoned.poison = { account_number: account, note: secret, key };
    await ex.runBrokerPoll(client(calls, poisoned, T0), T0);
    const failed = await ex.runBrokerPoll({
      async request(input) {
        calls.push({ method: input.method, url: input.url });
        throw new Error(`fetch failed ${secret} ${key} ${account}`);
      },
    }, T0 + 100);
    assert.equal(failed.failureKind, "network");
    const denied = client(calls, { ...emptyBook(), httpStatus: 401, poison: { account_number: account, secret, key } }, T0 + 200);
    const authed = await ex.runBrokerPoll(denied, T0 + 200);
    assert.equal(authed.failureKind, "auth");
    const blob = [
      JSON.stringify(ex.health(T0 + 200)),
      JSON.stringify(failed),
      JSON.stringify(authed),
      logs.join("\n"),
      ex.alerts.join("\n"),
      calls.map((call) => `${call.method} ${call.url}`).join("\n"),
      dumpDir(dir),
    ].join("\n");
    for (const sentinel of sentinels) assert.equal(blob.includes(sentinel), false, sentinel);
    assertGetOnly(calls);
  } finally {
    for (const method of methods) console[method] = original[method] as typeof console.log;
    ex.release();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("poll scenarios issue no broker POST, PATCH, or DELETE", async () => {
  assert.equal(POST_ENABLED, false);
  assert.equal(PAPER_POST_ENABLED, false);
  assert.equal(LIVE_POST_ENABLED, false);
  assert.equal(STRATEGY_APPROVED, false);
  const calls: Call[] = [];
  const dir = mkdtempSync(join(tmpdir(), "poll-methods-"));
  const ex = open(dir);
  const originalFetch = globalThis.fetch;
  let fetchMethods: string[] = [];
  try {
    await ex.runBrokerPoll(client(calls, emptyBook(), T0), T0);
    await ex.runBrokerPoll(client(calls, { ...emptyBook(), httpStatus: 401 }, T0 + 10), T0 + 10);
    await ex.runBrokerPoll(client(calls, { ...emptyBook(), httpStatus: 403 }, T0 + 20), T0 + 20);
    await ex.runBrokerPoll(client(calls, { ...emptyBook(), throwKind: "network" }, T0 + 30), T0 + 30);
    await ex.runBrokerPoll(client(calls, { ...emptyBook(), throwKind: "timeout" }, T0 + 40), T0 + 40);
    await ex.runBrokerPoll(client(calls, { ...emptyBook(), httpStatus: 500 }, T0 + 50), T0 + 50);
    await ex.runBrokerPoll(client(calls, { ...emptyBook(), positionsBody: { bad: true } }, T0 + 60), T0 + 60);
    assert.equal(ex.accept(signed({ clientOrderId: "methods-buy", nonce: "methods-buy" }), T0).state, "PROPOSED");
    await ex.runBrokerPoll(client(calls, emptyBook(), T0 + 70), T0 + 70);
    const unknown = emptyBook();
    unknown.open = [{ id: "brk-x", client_order_id: "methods-unknown", symbol: "SPY", status: "new", filled_qty: "0" }];
    await ex.runBrokerPoll(client(calls, unknown, T0 + 80), T0 + 80);
    await ex.runBrokerPoll(client(calls, emptyBook(), T0 + 2_000), T0 + 2_000);
    assertGetOnly(calls);
    assert.equal(calls.some((call) => call.method === "POST" || call.method === "PATCH" || call.method === "DELETE"), false);

    fetchMethods = [];
    globalThis.fetch = (async (_url: unknown, init?: { method?: string }) => {
      fetchMethods.push(init?.method ?? "GET");
      return new Response(JSON.stringify({ message: "no" }), { status: 401 });
    }) as typeof fetch;
    const paper = createPaperPollClient({ keyId: "PKTESTKEY1", secret: "paper-secret" });
    await assert.rejects(() => paper.request({ method: "POST", url: "https://paper-api.alpaca.markets/v2/orders" }), /PAPER POST DISABLED/);
    await assert.rejects(() => paper.request({ method: "PATCH", url: "https://paper-api.alpaca.markets/v2/orders" }), /PAPER POST DISABLED/);
    await assert.rejects(() => paper.request({ method: "DELETE", url: "https://paper-api.alpaca.markets/v2/orders/1" }), /PAPER POST DISABLED/);
    assert.deepEqual(fetchMethods, []);
    const got = await paper.request({ method: "GET", url: "https://paper-api.alpaca.markets/v2/account" });
    assert.equal(got.status, 401);
    assert.deepEqual(fetchMethods, ["GET"]);
  } finally {
    globalThis.fetch = originalFetch;
    ex.release();
    rmSync(dir, { recursive: true, force: true });
  }
});

class FakeTimers implements PollTimer {
  readonly delays: number[] = [];
  private queue: { fire: () => Promise<void> | void }[] = [];

  setTimer(delayMs: number, fire: () => Promise<void> | void): unknown {
    this.delays.push(delayMs);
    const handle = { fire };
    this.queue.push(handle);
    return handle;
  }

  clearTimer(handle: unknown): void {
    this.queue = this.queue.filter((item) => item !== handle);
  }

  async fireNext(): Promise<void> {
    const next = this.queue.shift();
    if (!next) throw new Error("no timer scheduled");
    await next.fire();
  }
}

test("successful polls wait the configured baseline between attempts", async () => {
  assert.equal(BROKER_POLL_INTERVAL_MS, 3_000);
  assert.equal(readPollIntervalMs({}), 3_000);
  assert.equal(readPollIntervalMs({ APEX_EXECUTOR_POLL_INTERVAL_MS: "4500" }), 4_500);
  assert.throws(() => readPollIntervalMs({ APEX_EXECUTOR_POLL_INTERVAL_MS: "0" }), /positive integer/);
  for (const baseline of [3_000, 4_500]) {
    const timers = new FakeTimers();
    const scheduler = new PollScheduler(baseline, async () => false, timers);
    await scheduler.start();
    await timers.fireNext();
    await timers.fireNext();
    assert.deepEqual(timers.delays, [baseline, baseline, baseline]);
    scheduler.stop();
  }
});

test("failure backoff doubles from the baseline and then caps", async () => {
  assert.equal(nextPollDelay(1_000, true), 6_000);
  assert.equal(nextPollDelay(3_000, true, 4_500), 9_000);
  const timers = new FakeTimers();
  const outcomes = [false, true, true, true, true, true];
  let index = 0;
  const scheduler = new PollScheduler(3_000, async () => outcomes[index++] ?? true, timers);
  await scheduler.start();
  for (let step = 0; step < outcomes.length - 1; step += 1) await timers.fireNext();
  assert.deepEqual(timers.delays, [3_000, 6_000, 12_000, 24_000, 30_000, 30_000]);
  scheduler.stop();
});

test("a success after failures returns the delay to the baseline", async () => {
  const timers = new FakeTimers();
  const outcomes = [false, true, true, false, false];
  let index = 0;
  const scheduler = new PollScheduler(4_500, async () => outcomes[index++] ?? false, timers);
  await scheduler.start();
  for (let step = 0; step < outcomes.length - 1; step += 1) await timers.fireNext();
  assert.deepEqual(timers.delays, [4_500, 9_000, 18_000, 4_500, 4_500]);
  scheduler.stop();
});

test("evidence older than 5000ms refuses accept and exit until reconciliation is OK", async () => {
  const dir = mkdtempSync(join(tmpdir(), "poll-age-"));
  const ex = open(dir, 5_000);
  const calls: Call[] = [];
  try {
    await ex.runBrokerPoll(client(calls, emptyBook(), T0), T0);
    assert.equal(ex.accept(signed({ clientOrderId: "age-buy", nonce: "age-buy", qty: 0.02 }), T0).state, "PROPOSED");
    const book = emptyBook();
    book.positions = [{ symbol: "SPY", qty: "0.02" }];
    book.orders["age-buy"] = { id: "brk-age", client_order_id: "age-buy", symbol: "SPY", side: "buy", status: "filled", filled_qty: "0.02" };
    assert.equal((await ex.runBrokerPoll(client(calls, book, T0), T0)).ok, true);
    assert.equal(ex.get("age-buy")?.state, "OPEN");
    const sell = signed({ side: "sell", qty: 0.01, clientOrderId: "age-sell", nonce: "age-sell", exitAuthorizationId: "exit-age", linkedEntryId: "age-buy" });
    const positions = async (url: string) => url.includes("/v2/positions") ? { status: 200, body: [{ symbol: "SPY", qty: "0.02" }] } : { status: 200, body: [] };
    const later = T0 + 5_001;
    const stale = ex.health(later);
    assert.equal(stale.brokerPoll.stale, true);
    assert.equal(stale.brokerPoll.staleAfterMs, 5_000);
    assert.equal(stale.ready, false);
    assert.match(ex.accept(signed({ clientOrderId: "age-new", nonce: "age-new", symbol: "QQQ" }), later).reason, /stale broker evidence/);
    assert.match((await ex.authorizeExit("age-buy", sell, positions, later)).reason, /stale broker evidence/);

    const missed = await ex.runBrokerPoll(client(calls, emptyBook(), later), later);
    assert.equal(missed.ok, false);
    assert.equal(ex.health(later).brokerPoll.reconciliation.outcome, "MISMATCH");
    assert.equal(ex.health(later).ready, false);
    assert.match(ex.accept(signed({ clientOrderId: "age-still", nonce: "age-still", symbol: "QQQ" }), later).reason, /reconciliation/);
    assert.match((await ex.authorizeExit("age-buy", sell, positions, later)).reason, /reconciliation/);

    assert.equal((await ex.runBrokerPoll(client(calls, book, later), later)).ok, true);
    const restored = ex.health(later);
    assert.equal(restored.brokerPoll.stale, false);
    assert.equal(restored.brokerPoll.reconciliation.outcome, "OK");
    assert.equal(restored.ready, true);
    assert.equal((await ex.authorizeExit("age-buy", sell, positions, later)).ok, true);
    assert.equal(ex.accept(signed({ clientOrderId: "age-qqq", nonce: "age-qqq", symbol: "QQQ" }), later).state, "PROPOSED");
    assertGetOnly(calls);
  } finally {
    ex.release();
    rmSync(dir, { recursive: true, force: true });
  }
});

function dumpDir(dir: string): string {
  const chunks: string[] = [];
  const walk = (current: string) => {
    for (const name of readdirSync(current)) {
      const path = join(current, name);
      if (statSync(path).isDirectory()) walk(path);
      else chunks.push(readFileSync(path, "utf8"));
    }
  };
  walk(dir);
  return chunks.join("\n");
}
