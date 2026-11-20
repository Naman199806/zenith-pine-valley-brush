/**
 * Production service. fetch is replaced at the HTTP layer. No network, no credentials file.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { signActivation } from "../src/activation.ts";
import { FILL_PAGE_LIMIT, readFillPage } from "../src/absence.ts";
import type { PaperWriter } from "../src/broker-write.ts";
import { boot } from "../src/main.ts";
import { createHttpPaperWriter, evidenceChannelFor, handleSupervisedInstruction } from "../src/production-cycle.ts";
import { Executor, openMarket, type ExecutorConfig } from "../src/runtime.ts";
import { signSupervisedGate, signSupervisedOrder, type SupervisedOrder } from "../src/supervised-order.ts";
import { hermesPerformanceRefusal } from "../src/fill-event.ts";

const started = Date.parse("2026-11-16T15:00:00Z");
const SECRET = "operator-secret-32-characters-min";
const GATE = "gate-secret-value-32-characters-ok";
const TOKEN = "executor-token";

function order(over: { side?: "buy" | "sell"; clientOrderId?: string; nonce?: string; qty?: string; notional?: string; linkedEntryId?: string; expiresAt?: string } = {}): SupervisedOrder {
  const sell = over.side === "sell";
  const draft = {
    v: 1 as const, source: "OPERATOR_SIGNED" as const, category: "SUPERVISED_PAPER_TEST" as const, symbol: "SPY" as const,
    side: sell ? "sell" as const : "buy" as const,
    orderType: sell ? "market_qty" as const : "market_notional" as const,
    timeInForce: "day" as const, extendedHours: false as const,
    clientOrderId: over.clientOrderId ?? (sell ? "spy-sell" : "spy-buy"),
    expiresAt: over.expiresAt ?? "2099-01-01T00:00:00Z",
    nonce: over.nonce ?? (sell ? "spy-sell-nonce" : "spy-buy-nonce"),
    session: "REGULAR" as const,
    decisionId: "svc", strategyId: "supervised-paper", strategyVersion: "v1", strategyApproved: false as const,
    operatorProof: null, gateProof: null,
    ...(sell
      ? { qty: over.qty ?? "0.02", exitAuthorizationId: "exit-svc", linkedEntryId: over.linkedEntryId ?? "spy-buy" }
      : { notional: over.notional ?? "2.00", exitAuthorizationId: null, linkedEntryId: null }),
  };
  const signed = draft as SupervisedOrder;
  signed.operatorProof = signSupervisedOrder(signed, SECRET);
  signed.gateProof = signSupervisedGate(signed, GATE, started);
  return signed;
}

function activation(at: number, durationMs: number) {
  const startsAt = new Date(at).toISOString();
  const expiresAt = new Date(at + durationMs).toISOString();
  return { v: 1 as const, kind: "PAPER_ACTIVATION" as const, startsAt, expiresAt, operatorProof: signActivation({ startsAt, expiresAt }, SECRET) };
}

class Sim {
  posts: { url: string; body: string }[] = [];
  inFlight = 0;
  maxInFlight = 0;
  position = "0";
  onPositions: (() => void) | null = null;
  hangPost = false;
  miss = false;
  cancelSeesFill = false;
  deleted = false;
  pageSize = 1;
  clock = started;
  fetch: typeof fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    assert.equal(url.includes("://api.alpaca.markets") && !url.includes("paper-api"), false);
    if (method === "POST") {
      this.inFlight += 1;
      this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
      const body = typeof init?.body === "string" ? init.body : "";
      this.posts.push({ url, body });
      if (this.hangPost) {
        await new Promise<void>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
      this.inFlight -= 1;
      const parsed = JSON.parse(body) as { client_order_id: string; side: string; qty?: string };
      if (parsed.side === "buy") this.position = "0.02";
      else this.position = "0";
      return json({
        id: `brk-${parsed.client_order_id}`, client_order_id: parsed.client_order_id, status: "filled",
        filled_qty: parsed.side === "sell" ? parsed.qty : "0.02", filled_avg_price: "100",
        symbol: "SPY", side: parsed.side, type: "market", time_in_force: "day", extended_hours: false,
      });
    }
    if (method === "DELETE") {
      this.deleted = true;
      return new Response(null, { status: 204 });
    }
    if (url.includes("/v2/account") && !url.includes("activities")) return json({ status: "ACTIVE", trading_blocked: false });
    if (url.includes("/v2/clock")) return json({ is_open: true });
    if (url.includes("/v2/positions")) {
      this.onPositions?.();
      return json(this.position === "0" ? [] : [{ symbol: "SPY", qty: this.position }]);
    }
    if (url.includes("quotes/latest")) return json({ quote: { bp: 100, ap: 100.01, t: new Date(this.clock).toISOString() } });
    if (url.includes("by_client_order_id")) {
      if (this.miss) return new Response(JSON.stringify({ message: "order not found" }), { status: 404 });
      const id = new URL(url).searchParams.get("client_order_id") ?? "";
      if (this.cancelSeesFill && this.deleted) {
        return json({ id: `brk-${id}`, client_order_id: id, status: "filled", filled_qty: "0.02", filled_avg_price: "100", symbol: "SPY", side: "buy" });
      }
      const status = this.deleted ? "canceled" : "filled";
      return json({ id: `brk-${id}`, client_order_id: id, status, filled_qty: status === "canceled" ? "0" : "0.02", filled_avg_price: status === "canceled" ? null : "100", symbol: "SPY", side: "buy" });
    }
    if (url.includes("/activities/FILL")) {
      const page = Array.from({ length: this.pageSize }, (_, i) => ({
        activity_type: "FILL", id: `fill-${i}`, qty: "0.02", price: "100", side: "buy", symbol: "SPY",
        transaction_time: new Date(this.clock).toISOString(), order_id: "brk-spy-buy", type: "fill",
      }));
      return json(page);
    }
    if (url.includes("/v2/orders")) return json([]);
    return json([]);
  }) as typeof fetch;
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

function serviceEnv(dir: string, over: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    APEX_EXECUTOR_DATA: dir,
    APEX_EXECUTOR_PORT: "0",
    APEX_EXECUTOR_HEALTH_TOKEN: TOKEN,
    APEX_EXECUTOR_PAPER_KEY_ID: "PKTESTKEY1",
    APEX_EXECUTOR_PAPER_SECRET: "paper-secret",
    APEX_OPERATOR_SECRET: SECRET,
    APEX_GATE_SECRET: GATE,
    PAPER_POST_ENABLED: "true",
    ...over,
  };
  for (const [key, value] of Object.entries(over)) if (value === undefined) delete env[key];
  return env;
}

async function post(port: number, path: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-executor-token": TOKEN },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}

test("the production service completes a signed SPY buy and exit to broker-confirmed FLAT", async () => {
  process.env.APEX_OPERATOR_SECRET = SECRET;
  process.env.APEX_GATE_SECRET = GATE;
  const dir = mkdtempSync(join(tmpdir(), "svc-flat-"));
  const sim = new Sim();
  const clock = { t: started };
  sim.clock = started;
  const booted = await boot(serviceEnv(dir), { fetchImpl: sim.fetch, now: () => clock.t, sleep: async () => {} });
  const address = booted.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  try {
    assert.equal(evidenceChannelFor(sim.fetch), "injected");
    const health = await fetch(`http://127.0.0.1:${port}/health`, { headers: { "x-executor-token": TOKEN } });
    const before = await health.json() as { supervisedActivation: string; strategyApproved: boolean; livePost: string; reconciliation?: { outcome: string }; brokerPoll: { reconciliation: { outcome: string }; stale: boolean } };
    assert.equal(before.supervisedActivation, "closed");
    assert.equal(before.strategyApproved, false);
    assert.equal(before.livePost, "DISABLED");
    assert.equal(before.brokerPoll.stale, false);
    assert.equal(before.brokerPoll.reconciliation.outcome, "OK");
    const armed = await post(port, "/activation", activation(started, 10 * 60 * 1000));
    assert.equal(armed.status, 200, JSON.stringify(armed.body));
    const buy = await post(port, "/instructions", order());
    assert.equal(buy.status, 202, JSON.stringify(buy.body));
    assert.equal(booted.exec.get("spy-buy")?.state, "OPEN");
    const sell = await post(port, "/instructions", order({ side: "sell" }));
    assert.equal(sell.status, 202, JSON.stringify(sell.body));
    assert.equal(booted.exec.get("spy-sell")?.state, "FLAT");
    assert.equal(booted.exec.get("spy-buy")?.state, "FLAT");
    const posts = sim.posts.filter((call) => call.url.endsWith("/v2/orders"));
    assert.equal(posts.length, 2);
    assert.equal(JSON.parse(posts[0]!.body).notional, "2.00");
    assert.equal(JSON.parse(posts[1]!.body).qty, "0.02");
    const fills = booted.exec.fillEvents();
    assert.ok(fills.length >= 1);
    assert.equal(fills[0]?.fee, null);
    assert.equal(fills[0]?.feeKnown, false);
    assert.equal(fills[0]?.netPnlAttributable, false);
    assert.equal(fills[0]?.evidenceChannel, "injected");
    assert.ok(fills[0]?.brokerOrderId);
    assert.ok(fills[0]?.fillId);
    assert.match(hermesPerformanceRefusal(fills[0]!) ?? "", /test evidence/);
    assert.equal(booted.exec.trustedEvidence().length, 0);
  } finally {
    booted.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the activation window expiring mid-session stops the next write", async () => {
  process.env.APEX_OPERATOR_SECRET = SECRET;
  process.env.APEX_GATE_SECRET = GATE;
  const dir = mkdtempSync(join(tmpdir(), "svc-expire-"));
  const sim = new Sim();
  const clock = { t: started };
  const booted = await boot(serviceEnv(dir), { fetchImpl: sim.fetch, now: () => clock.t, sleep: async () => {} });
  const address = booted.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  try {
    assert.equal((await post(port, "/activation", activation(started, 1_000))).status, 200);
    assert.equal((await post(port, "/instructions", order({ clientOrderId: "exp-buy", nonce: "exp-buy" }))).status, 202);
    clock.t = started + 1_500;
    sim.clock = clock.t;
    const postsBefore = sim.posts.length;
    const next = await post(port, "/instructions", order({ clientOrderId: "exp-buy-2", nonce: "exp-buy-2" }));
    assert.equal(next.status, 422);
    assert.match(String(next.body.reason), /activation window closed/);
    assert.equal(booted.exec.get("exp-buy-2"), undefined);
    assert.equal(sim.posts.length, postsBefore);
  } finally {
    booted.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a dev flag alone does not activate and two writes cannot overlap", async () => {
  process.env.APEX_OPERATOR_SECRET = SECRET;
  process.env.APEX_GATE_SECRET = GATE;
  const dir = mkdtempSync(join(tmpdir(), "svc-dev-"));
  const sim = new Sim();
  const booted = await boot(serviceEnv(dir, { PAPER_POST_ENABLED: undefined, APEX_EXECUTOR_DEV_SUBMIT: "true" }), { fetchImpl: sim.fetch, now: () => started, sleep: async () => {} });
  const address = booted.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  try {
    const armed = await post(port, "/activation", activation(started, 60_000));
    assert.equal(armed.status, 422);
    assert.match(String(armed.body.reason), /dev flag/);
    assert.equal(sim.posts.length, 0);
  } finally {
    booted.stop();
    rmSync(dir, { recursive: true, force: true });
  }

  const dir2 = mkdtempSync(join(tmpdir(), "svc-serial-"));
  const sim2 = new Sim();
  const booted2 = await boot(serviceEnv(dir2), { fetchImpl: sim2.fetch, now: () => started, sleep: async () => {} });
  const address2 = booted2.server.address();
  const port2 = typeof address2 === "object" && address2 ? address2.port : 0;
  try {
    assert.equal((await post(port2, "/activation", activation(started, 60_000))).status, 200);
    const first = post(port2, "/instructions", order({ clientOrderId: "one", nonce: "one" }));
    const second = post(port2, "/instructions", order({ clientOrderId: "two", nonce: "two" }));
    await Promise.all([first, second]);
    assert.equal(sim2.maxInFlight, 1);
    assert.equal(sim2.posts.length, 1);
  } finally {
    booted2.stop();
    rmSync(dir2, { recursive: true, force: true });
  }
});

test("a POST timeout is not retried, cancel reports the broker fill, and a full fill page is not absence", async () => {
  const dir = mkdtempSync(join(tmpdir(), "svc-adv-"));
  process.env.APEX_OPERATOR_SECRET = SECRET;
  process.env.APEX_GATE_SECRET = GATE;
  const config: ExecutorConfig = {
    mode: "PAPER", postEnabled: false, liveCredentialsLoaded: false,
    statePath: join(dir, "state.json"), lockPath: join(dir, "writer.lock"), inboxPath: join(dir, "inbox.jsonl"),
    journalPath: join(dir, "journal.jsonl"), hermesPath: join(dir, "hermes.json"), fillsPath: join(dir, "fills.jsonl"),
  };
  const exec = new Executor(config, { keyId: "PKTESTKEY1", secret: "paper-secret" });
  exec.observeMarket(openMarket(started), started);
  const sim = new Sim();
  sim.hangPost = true;
  const creds = { keyId: "PKTESTKEY1", secret: "paper-secret" };
  const sleeps: number[] = [];
  const writer = createHttpPaperWriter(sim.fetch, creds, {
    timeoutMs: 30,
    charge: (purpose) => exec.spendBudget(started, 1, purpose),
    sleep: async (ms) => { sleeps.push(ms); },
    evidenceChannel: "injected",
  });
  const env = { ...process.env, PAPER_POST_ENABLED: "true", APEX_OPERATOR_SECRET: SECRET, APEX_GATE_SECRET: GATE };
  try {
    exec.armPaperActivation(activation(started, 60_000), env, started);
    const buy = order({ clientOrderId: "hang", nonce: "hang" });
    exec.acceptSupervised(buy, started);
    const hung = await exec.submitPaper(buy, writer, env, started);
    assert.equal(hung.orderState, "UNKNOWN");
    assert.equal(sim.posts.length, 1);
    const again = await exec.submitPaper(buy, writer, env, started);
    assert.match(again.reason, /UNKNOWN|duplicate|in-flight/);
    assert.equal(sim.posts.length, 1);

    sim.hangPost = false;
    sim.cancelSeesFill = true;
    sim.posts.length = 0;
    const cancelWriter = createHttpPaperWriter(sim.fetch, creds, { timeoutMs: 1_000, charge: () => true, evidenceChannel: "injected" });
    const canceled = await cancelWriter.cancel("hang");
    assert.equal(canceled.kind, "ack");
    if (canceled.kind === "ack") {
      assert.equal(canceled.body.status, "filled");
      assert.equal(canceled.body.filled_qty, "0.02");
    }

    sim.pageSize = FILL_PAGE_LIMIT;
    const paged = createHttpPaperWriter(sim.fetch, creds, { charge: () => true, maxFillPages: 1, evidenceChannel: "injected" });
    const page = await paged.listFills();
    assert.equal(readFillPage(page.body).truncated, true);
    assert.equal(evidenceChannelFor(sim.fetch), "injected");
    assert.equal(evidenceChannelFor(fetch), "alpaca-http");
    void sleeps;
  } finally {
    exec.release();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("startup recovery blocks instructions and the reserve cannot buy", async () => {
  const dir = mkdtempSync(join(tmpdir(), "svc-budget-"));
  process.env.APEX_OPERATOR_SECRET = SECRET;
  process.env.APEX_GATE_SECRET = GATE;
  const exec = new Executor({
    mode: "PAPER", postEnabled: false, liveCredentialsLoaded: false,
    statePath: join(dir, "state.json"), lockPath: join(dir, "writer.lock"), inboxPath: join(dir, "inbox.jsonl"),
    journalPath: join(dir, "journal.jsonl"), hermesPath: join(dir, "hermes.json"), fillsPath: join(dir, "fills.jsonl"),
  }, { keyId: "PKTESTKEY1", secret: "paper-secret" });
  exec.observeMarket(openMarket(started), started);
  const sim = new Sim();
  const writer = createHttpPaperWriter(sim.fetch, { keyId: "PKTESTKEY1", secret: "paper-secret" }, {
    charge: (purpose) => exec.spendBudget(started, 1, purpose),
    evidenceChannel: "injected",
  });
  const env = { ...process.env, PAPER_POST_ENABLED: "true", APEX_OPERATOR_SECRET: SECRET, APEX_GATE_SECRET: GATE };
  const sleeps: number[] = [];
  try {
    exec.markStartupPending();
    const blocked = await handleSupervisedInstruction(exec, order(), writer, env, started);
    assert.match(blocked.reason, /startup recovery/);
    assert.equal(sim.posts.length, 0);
    exec.markStartupReady();
    exec.armPaperActivation(activation(started, 60_000), env, started);
    assert.equal(exec.spendBudget(started, 140, "entry"), true);
    const refused = await handleSupervisedInstruction(exec, order(), writer, env, started);
    assert.match(refused.reason, /budget/);
    assert.equal(sim.posts.length, 0);
    assert.equal(exec.spendBudget(started, 1, "recovery"), true);

    const sleepDir = mkdtempSync(join(tmpdir(), "svc-sleep-"));
    const sleeper = new Executor({
      mode: "PAPER", postEnabled: false, liveCredentialsLoaded: false,
      statePath: join(sleepDir, "state.json"), lockPath: join(sleepDir, "writer.lock"), inboxPath: join(sleepDir, "inbox.jsonl"),
      journalPath: join(sleepDir, "journal.jsonl"), hermesPath: join(sleepDir, "hermes.json"), fillsPath: join(sleepDir, "fills.jsonl"),
    }, { keyId: "PKTESTKEY1", secret: "paper-secret" });
    sleeper.observeMarket(openMarket(started), started);
    sleeper.armPaperActivation(activation(started, 60_000), env, started);
    const unknown = order({ clientOrderId: "sleep-buy", nonce: "sleep-buy" });
    sleeper.acceptSupervised(unknown, started);
    const ambiguous = createHttpPaperWriter(sim.fetch, { keyId: "PKTESTKEY1", secret: "paper-secret" }, {
      timeoutMs: 20,
      charge: () => true,
      evidenceChannel: "injected",
    });
    sim.hangPost = true;
    await sleeper.submitPaper(unknown, ambiguous, env, started);
    sim.hangPost = false;
    sim.miss = true;
    sim.pageSize = FILL_PAGE_LIMIT;
    const recovery = createHttpPaperWriter(sim.fetch, { keyId: "PKTESTKEY1", secret: "paper-secret" }, {
      charge: () => true,
      sleep: async (ms) => { sleeps.push(ms); },
      maxFillPages: 1,
      evidenceChannel: "injected",
    });
    const recovered = await sleeper.recoverInFlight(recovery, started, async (ms) => { sleeps.push(ms); });
    assert.match(recovered.reason, /without sufficient evidence/);
    assert.ok(sleeps.length >= 1);
    assert.equal(sleeper.get(unknown.clientOrderId)?.orderState, "UNKNOWN");
    sleeper.release();
    rmSync(sleepDir, { recursive: true, force: true });
  } finally {
    exec.release();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a write-disabled boot and a closed window refuse before a nonce is consumed", async () => {
  process.env.APEX_OPERATOR_SECRET = SECRET;
  process.env.APEX_GATE_SECRET = GATE;
  const dir = mkdtempSync(join(tmpdir(), "svc-off-"));
  const sim = new Sim();
  const booted = await boot(serviceEnv(dir, { PAPER_POST_ENABLED: undefined }), { fetchImpl: sim.fetch, now: () => started, sleep: async () => {} });
  const address = booted.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  try {
    const ticket = order({ clientOrderId: "off-buy", nonce: "off-nonce" });
    const first = await post(port, "/instructions", ticket);
    const second = await post(port, "/instructions", ticket);
    assert.equal(first.status, 422);
    assert.match(String(first.body.reason), /PAPER POST DISABLED/);
    assert.match(String(second.body.reason), /PAPER POST DISABLED/);
    assert.equal(booted.exec.get("off-buy"), undefined);
    assert.equal(sim.posts.length, 0);
  } finally {
    booted.stop();
    rmSync(dir, { recursive: true, force: true });
  }

  const dir2 = mkdtempSync(join(tmpdir(), "svc-closed-"));
  const sim2 = new Sim();
  const closed = await boot(serviceEnv(dir2), { fetchImpl: sim2.fetch, now: () => started, sleep: async () => {} });
  const address2 = closed.server.address();
  const port2 = typeof address2 === "object" && address2 ? address2.port : 0;
  try {
    const ticket = order({ clientOrderId: "closed-buy", nonce: "closed-nonce" });
    const first = await post(port2, "/instructions", ticket);
    const second = await post(port2, "/instructions", ticket);
    assert.match(String(first.body.reason), /activation window closed/);
    assert.match(String(second.body.reason), /activation window closed/);
    assert.equal(closed.exec.get("closed-buy"), undefined);
    assert.equal(sim2.posts.length, 0);
  } finally {
    closed.stop();
    rmSync(dir2, { recursive: true, force: true });
  }
});

test("an expired recheck before POST becomes a terminal untransmitted order and an emergency exit still needs a signed ticket", async () => {
  process.env.APEX_OPERATOR_SECRET = SECRET;
  process.env.APEX_GATE_SECRET = GATE;
  const dir = mkdtempSync(join(tmpdir(), "svc-emerg-"));
  const sim = new Sim();
  const clock = { t: started };
  const booted = await boot(serviceEnv(dir), { fetchImpl: sim.fetch, now: () => clock.t, sleep: async () => {} });
  const address = booted.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  try {
    assert.equal((await post(port, "/activation", activation(started, 1_000))).status, 200);
    assert.equal((await post(port, "/instructions", order({ clientOrderId: "em-buy", nonce: "em-buy" }))).status, 202);
    sim.onPositions = () => { clock.t = started + 8_000; sim.clock = clock.t; };
    const sell = await post(port, "/instructions", order({ side: "sell", clientOrderId: "em-sell", nonce: "em-sell", linkedEntryId: "em-buy" }));
    assert.equal(sell.status, 422);
    assert.equal(booted.exec.get("em-sell")?.orderState, "expired");
    assert.equal(sim.posts.length, 1);
    clock.t = started + 1_500;
    sim.clock = clock.t;
    sim.onPositions = null;
    const again = order({ clientOrderId: "em-buy-2", nonce: "em-buy-2" });
    const blocked = await post(port, "/instructions", again);
    const blockedAgain = await post(port, "/instructions", again);
    assert.match(String(blocked.body.reason), /activation window closed/);
    assert.match(String(blockedAgain.body.reason), /activation window closed/);
    assert.equal(booted.exec.get("em-buy-2"), undefined);
    const emergency = await post(port, "/instructions", order({ side: "sell", clientOrderId: "em-exit", nonce: "em-exit", linkedEntryId: "em-buy" }));
    assert.equal(emergency.status, 202, JSON.stringify(emergency.body));
    assert.equal(booted.exec.get("em-exit")?.state, "FLAT");
    assert.equal(booted.exec.get("em-buy")?.state, "FLAT");
  } finally {
    booted.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an overlapping poll cannot regress an acknowledged order and a delayed fill survives restart", async () => {
  process.env.APEX_OPERATOR_SECRET = SECRET;
  process.env.APEX_GATE_SECRET = GATE;
  const dir = mkdtempSync(join(tmpdir(), "svc-race-"));
  const env = { ...process.env, PAPER_POST_ENABLED: "true", APEX_OPERATOR_SECRET: SECRET, APEX_GATE_SECRET: GATE };
  const config = {
    mode: "PAPER" as const, postEnabled: false as const, liveCredentialsLoaded: false,
    statePath: join(dir, "state.json"), lockPath: join(dir, "writer.lock"), inboxPath: join(dir, "inbox.jsonl"),
    journalPath: join(dir, "journal.jsonl"), hermesPath: join(dir, "hermes.json"), fillsPath: join(dir, "fills.jsonl"),
  };
  const ex = new Executor(config, { keyId: "PKTESTKEY1", secret: "paper-secret" });
  ex.observeMarket(openMarket(started), started);
  ex.useEnv(env);
  ex.requireActivation();
  ex.armPaperActivation(activation(started, 60_000), env, started);
  const fills: unknown[] = [];
  let releasePositions: () => void = () => {};
  const positionsHeld = new Promise<void>((resolve) => { releasePositions = resolve; });
  let waitForSell = false;
  let sold = false;
  const writer: PaperWriter = {
    networkWrite: "injected",
    async submit(order) {
      const row = order as { client_order_id: string; side: string; qty?: string };
      if (row.side === "sell") sold = true;
      return { kind: "ack", status: 200, body: { id: `brk-${row.client_order_id}`, client_order_id: row.client_order_id, status: "filled", filled_qty: row.side === "sell" ? row.qty : "0.02", filled_avg_price: "100", symbol: "SPY", side: row.side } };
    },
    async cancel() { return { kind: "ambiguous", reason: "unused" }; },
    async getOrder(id) { return { status: 200, body: { id: `brk-${id}`, client_order_id: id, status: "filled", filled_qty: "0.02", filled_avg_price: "100", symbol: "SPY", side: "buy" } }; },
    async getPositions() {
      if (waitForSell && !sold) await positionsHeld;
      return { status: 200, body: sold ? [] : [{ symbol: "SPY", qty: "0.02" }] };
    },
    async getOpenOrders() { return { status: 200, body: [] }; },
    async listOrders() { return { status: 200, body: [] }; },
    async listFills() { return { status: 200, body: fills }; },
  };
  ex.attachActivityWriter(writer);
  try {
    const buy = order({ clientOrderId: "race-buy", nonce: "race-buy" });
    assert.equal(ex.acceptSupervised(buy, started).accepted, true);
    assert.equal((await ex.submitPaper(buy, writer, env, started)).orderState, "filled");
    assert.equal(ex.fillEvents().length, 0);
    waitForSell = true;
    const sell = order({ side: "sell", clientOrderId: "race-sell", nonce: "race-sell", linkedEntryId: "race-buy" });
    ex.acceptSupervised(sell, started);
    const sent = ex.submitPaper(sell, writer, env, started);
    const stale = {
      async request(input: { method: string; url: string }) {
        const url = input.url;
        if (url.includes("/v2/account")) return { status: 200, body: { status: "ACTIVE", trading_blocked: false } };
        if (url.includes("/v2/clock")) return { status: 200, body: { is_open: true } };
        if (url.includes("/v2/positions")) return { status: 200, body: [{ symbol: "SPY", qty: "0.02" }] };
        if (url.includes("quotes")) return { status: 200, body: { quote: { bp: 100, ap: 100.01, t: new Date(started).toISOString() } } };
        if (url.includes("by_client_order_id")) return { status: 200, body: { id: "brk-race-buy", client_order_id: "race-buy", status: "new", filled_qty: "0", symbol: "SPY", side: "buy" } };
        return { status: 200, body: [] };
      },
    };
    const polled = ex.runBrokerPoll(stale, started);
    releasePositions();
    await sent;
    await polled;
    assert.notEqual(ex.get("race-buy")?.orderState, "UNKNOWN");
    assert.equal(ex.get("race-sell")?.state, "FLAT");
    ex.release();
    fills.push({ activity_type: "FILL", id: "late-fill", order_id: "brk-race-buy", qty: "0.02", price: "100", side: "buy", symbol: "SPY", transaction_time: "2026-11-16T15:01:00Z", type: "fill" });
    const restarted = new Executor(config, { keyId: "PKTESTKEY1", secret: "paper-secret" });
    restarted.attachActivityWriter(writer);
    const poll = {
      async request(input: { method: string; url: string }) {
        const url = input.url;
        if (url.includes("/v2/account")) return { status: 200, body: { status: "ACTIVE", trading_blocked: false } };
        if (url.includes("/v2/clock")) return { status: 200, body: { is_open: true } };
        if (url.includes("/v2/positions")) return { status: 200, body: [] };
        if (url.includes("quotes")) return { status: 200, body: { quote: { bp: 100, ap: 100.01, t: new Date(started).toISOString() } } };
        if (url.includes("by_client_order_id")) return { status: 200, body: { id: "brk-race-buy", client_order_id: "race-buy", status: "filled", filled_qty: "0.02", filled_avg_price: "100", symbol: "SPY", side: "buy" } };
        return { status: 200, body: [] };
      },
    };
    await restarted.runBrokerPoll(poll, started);
    assert.equal(restarted.fillEvents().length, 1);
    assert.equal(restarted.fillEvents()[0]?.fillId, "late-fill");
    assert.equal(restarted.fillEvents()[0]?.feeKnown, false);
    await restarted.runBrokerPoll(poll, started);
    assert.equal(restarted.fillEvents().length, 1);
    restarted.release();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cancel does not treat partially_filled as a terminal canceled state", async () => {
  process.env.APEX_OPERATOR_SECRET = SECRET;
  process.env.APEX_GATE_SECRET = GATE;
  const dir = mkdtempSync(join(tmpdir(), "svc-cancel-"));
  const env = { ...process.env, PAPER_POST_ENABLED: "true", APEX_OPERATOR_SECRET: SECRET, APEX_GATE_SECRET: GATE };
  const ex = new Executor({
    mode: "PAPER", postEnabled: false, liveCredentialsLoaded: false,
    statePath: join(dir, "state.json"), lockPath: join(dir, "writer.lock"), inboxPath: join(dir, "inbox.jsonl"),
    journalPath: join(dir, "journal.jsonl"), hermesPath: join(dir, "hermes.json"), fillsPath: join(dir, "fills.jsonl"),
  }, { keyId: "PKTESTKEY1", secret: "paper-secret" });
  ex.observeMarket(openMarket(started), started);
  ex.useEnv(env);
  ex.armPaperActivation(activation(started, 60_000), env, started);
  let deleted = false;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (method === "POST") {
      return json({ id: "brk-part", client_order_id: "part-buy", status: "accepted", filled_qty: "0.01", filled_avg_price: "100", symbol: "SPY", side: "buy" });
    }
    if (method === "DELETE") { deleted = true; return new Response(null, { status: 204 }); }
    if (url.includes("by_client_order_id")) {
      return json({ id: "brk-part", client_order_id: "part-buy", status: deleted ? "partially_filled" : "accepted", filled_qty: "0.01", filled_avg_price: "100", symbol: "SPY", side: "buy" });
    }
    if (url.includes("/v2/positions")) return json([{ symbol: "SPY", qty: "0.01" }]);
    return json([]);
  }) as typeof fetch;
  const writer = createHttpPaperWriter(fetchImpl, { keyId: "PKTESTKEY1", secret: "paper-secret" }, { charge: () => true, evidenceChannel: "injected", sleep: async () => {} });
  try {
    const buy = order({ clientOrderId: "part-buy", nonce: "part-buy" });
    ex.acceptSupervised(buy, started);
    assert.equal((await ex.submitPaper(buy, writer, env, started)).orderState, "partially_filled");
    const canceled = await ex.cancelPaper("part-buy", writer, env, started);
    assert.equal(canceled.canceled, false);
    assert.notEqual(canceled.orderState, "canceled");
    assert.equal(ex.get("part-buy")?.orderState, "UNKNOWN");
  } finally {
    ex.release();
    rmSync(dir, { recursive: true, force: true });
  }
});
