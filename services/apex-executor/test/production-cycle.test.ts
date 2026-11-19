/**
 * Enablement-branch wiring. fetch is replaced at the HTTP layer. No network.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Executor, openMarket, type ExecutorConfig } from "../src/runtime.ts";
import { exactBrokerBody, signSupervisedGate, signSupervisedOrder, type SupervisedOrder } from "../src/supervised-order.ts";
import { createHttpPaperWriter, runSupervisedPaperCycle } from "../src/production-cycle.ts";
import { createDisabledPaperWriter } from "../src/broker-write.ts";

const now = Date.parse("2026-11-16T15:00:00Z");
const SECRET = "operator-secret-32-characters-min";
const GATE = "gate-secret-value-32-characters-ok";
const creds = { keyId: "PKTESTKEY1", secret: "paper-secret" };

function order(): SupervisedOrder {
  const draft = {
    v: 1 as const, source: "OPERATOR_SIGNED" as const, category: "SUPERVISED_PAPER_TEST" as const, symbol: "SPY" as const,
    side: "buy" as const, orderType: "market_notional" as const, timeInForce: "day" as const, extendedHours: false as const,
    notional: "2.00", clientOrderId: "http-buy", expiresAt: "2099-01-01T00:00:00Z", nonce: "http-nonce", session: "REGULAR" as const,
    exitAuthorizationId: null, linkedEntryId: null, decisionId: "http", strategyId: "supervised-paper", strategyVersion: "v1",
    strategyApproved: false as const, operatorProof: null, gateProof: null,
  };
  const signed = draft as SupervisedOrder;
  signed.operatorProof = signSupervisedOrder(signed, SECRET);
  signed.gateProof = signSupervisedGate(signed, GATE, now);
  return signed;
}

function start(dir: string): Executor {
  process.env.APEX_OPERATOR_SECRET = SECRET;
  process.env.APEX_GATE_SECRET = GATE;
  const config: ExecutorConfig = {
    mode: "PAPER", postEnabled: false, liveCredentialsLoaded: false,
    statePath: join(dir, "state.json"), lockPath: join(dir, "writer.lock"), inboxPath: join(dir, "inbox.jsonl"),
    journalPath: join(dir, "journal.jsonl"), hermesPath: join(dir, "hermes.json"), fillsPath: join(dir, "fills.jsonl"),
  };
  const exec = new Executor(config, creds);
  exec.observeMarket(openMarket(now), now);
  return exec;
}

function fakeFetch(calls: { method: string; url: string; body: string | undefined }[]): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ method: init?.method ?? "GET", url, body: typeof init?.body === "string" ? init.body : undefined });
    assert.equal(url.includes("://api.alpaca.markets"), false);
    if (init?.method === "POST") {
      return new Response(JSON.stringify({
        id: "brk-http", client_order_id: "http-buy", status: "accepted", filled_qty: "0", filled_avg_price: null,
        symbol: "SPY", side: "buy", type: "market", time_in_force: "day", extended_hours: false,
      }), { status: 200 });
    }
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    if (url.includes("by_client_order_id")) {
      return new Response(JSON.stringify({ id: "brk-http", client_order_id: "http-buy", status: "accepted", filled_qty: "0", symbol: "SPY", side: "buy" }), { status: 200 });
    }
    return new Response("[]", { status: 200 });
  }) as typeof fetch;
}

test("the production cycle posts the signed body to the paper host and nowhere else", async () => {
  const dir = mkdtempSync(join(tmpdir(), "http-cycle-"));
  const exec = start(dir);
  const calls: { method: string; url: string; body: string | undefined }[] = [];
  const signed = order();
  const env = { ...process.env, APEX_OPERATOR_SECRET: SECRET, APEX_GATE_SECRET: GATE, PAPER_POST_ENABLED: "true" };
  try {
    exec.acceptSupervised(signed, now);
    const result = await runSupervisedPaperCycle({ exec, fetchImpl: fakeFetch(calls), creds, env, now, order: signed });
    assert.equal(result.submitted, true, result.reason);
    const post = calls.find((call) => call.method === "POST");
    assert.ok(post);
    assert.equal(post.url, "https://paper-api.alpaca.markets/v2/orders");
    assert.deepEqual(JSON.parse(post.body ?? "{}"), exactBrokerBody(signed));
    assert.equal(calls.some((call) => call.method === "POST" && call.url.includes("api.alpaca.markets") && !call.url.includes("paper-api")), false);
    const writer = createHttpPaperWriter(fakeFetch(calls), creds);
    const canceled = await writer.cancel("http-buy");
    assert.equal(canceled.kind, "ack");
    assert.ok(calls.some((call) => call.method === "DELETE" && call.url === "https://paper-api.alpaca.markets/v2/orders/brk-http"));
  } finally {
    exec.release();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a stale supervised order does not reach fetch POST", async () => {
  const dir = mkdtempSync(join(tmpdir(), "http-stale-"));
  const exec = start(dir);
  const calls: { method: string; url: string; body: string | undefined }[] = [];
  const signed = order();
  const env = { ...process.env, APEX_OPERATOR_SECRET: SECRET, APEX_GATE_SECRET: GATE, PAPER_POST_ENABLED: "true" };
  try {
    exec.acceptSupervised(signed, now);
    const result = await runSupervisedPaperCycle({ exec, fetchImpl: fakeFetch(calls), creds, env, now: now + 5_001, order: signed });
    assert.match(result.reason, /stale/);
    assert.equal(calls.some((call) => call.method === "POST"), false);
  } finally {
    exec.release();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the disabled adapter still throws before fetch", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return new Response("no");
  }) as typeof fetch;
  await assert.rejects(() => createDisabledPaperWriter(fetchImpl).submit({}), /PAPER POST DISABLED/);
  assert.equal(calls, 0);
});
