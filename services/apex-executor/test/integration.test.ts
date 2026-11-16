import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { orderFromBroker, type BrokerOrder } from "../../../src/lib/apex/broker/client.ts";
import { ROLES } from "../../../src/lib/apex/research/canonical-decision.ts";
import { architectureReadiness } from "../../../src/lib/apex/live/architecture.ts";
import { issueGateProof, type GateProof } from "../../../src/lib/apex/live/executor.ts";
import { HermesJournal } from "../../../src/lib/apex/live/journal.ts";
import {
  limitApprovalMaterial,
  postEnableMaterial,
  protectiveMaterial,
  type OperatorApproval,
  type PaperLimitTicket,
  type PostEnableGrant,
  type ProtectiveApproval,
} from "../../../src/lib/apex/broker/paper-equity-transport.ts";
import { createAlpacaLiveTransport, createAlpacaPaperTransport, type EvidenceSource, type ExecutorTransport } from "../src/broker.ts";
import { assertNoLiveCreds, loadLiveCredentials, loadPaperCredentials } from "../src/credentials.ts";
import { createExecutorServer } from "../src/main.ts";
import { liveSelectionBlocked, MODE_GATE } from "../src/mode.ts";
import { flatSnapshot, type MarketSnapshot } from "../src/risk.ts";
import { Executor } from "../src/runtime.ts";
import { readPaperSnapshot } from "../src/broker.ts";

const NOW = Date.parse("2026-11-16T15:00:00Z");
const EXPIRES = "2026-11-16T16:00:00-05:00";
const OPERATOR = "operator-secret-value-0123456789abcd";
const GATE = "gate-secret-value-0123456789abcdef";

function signLimit(ticket: PaperLimitTicket, secret = OPERATOR): OperatorApproval {
  return {
    source: "OPERATOR_SIGNED",
    clientOrderId: ticket.clientOrderId,
    symbol: "SPY",
    side: ticket.side,
    qty: ticket.qty,
    limitPrice: ticket.limitPrice,
    session: "REGULAR",
    expiresAt: ticket.expiresAt,
    quoteTimestamp: new Date(NOW).toISOString(),
    proof: createHmac("sha256", secret).update(limitApprovalMaterial(ticket)).digest("hex"),
  };
}

function signGrant(enable: "PAPER_POST" | "LIVE_POST", expiresAt = "2026-11-16T18:00:00Z", secret = OPERATOR): PostEnableGrant {
  const confirmation = enable === "PAPER_POST" ? "I_AUTHORIZE_PAPER_POST" : "I_AUTHORIZE_LIVE_POST";
  return {
    source: "OPERATOR_SIGNED",
    enable,
    confirmation,
    expiresAt,
    proof: createHmac("sha256", secret).update(postEnableMaterial({ enable, confirmation, expiresAt })).digest("hex"),
  };
}

function signStop(fields: Omit<ProtectiveApproval, "source" | "proof">, secret = OPERATOR): ProtectiveApproval {
  return { source: "OPERATOR_SIGNED", ...fields, proof: createHmac("sha256", secret).update(protectiveMaterial(fields)).digest("hex") };
}

interface Draft {
  at?: number;
  clientOrderId?: string;
  nonce?: string;
  side?: "buy" | "sell";
  purpose?: "ENTRY" | "EXIT" | "STOP";
  orderType?: "limit" | "stop" | "stop_limit";
  qty?: number;
  limitPrice?: number;
  stopPrice?: number | null;
  expiresAt?: string;
  linkedEntryId?: string | null;
  sizedNotional?: number;
  category?: string;
  strategyApproved?: boolean;
  dataIntegrityOk?: boolean;
  riskOk?: boolean;
  notional?: number;
}

function instruction(over: Draft = {}) {
  const at = over.at ?? NOW;
  const side = over.side ?? "buy";
  const purpose = over.purpose ?? (side === "buy" ? "ENTRY" : "EXIT");
  const orderType = over.orderType ?? (purpose === "STOP" ? "stop" : "limit");
  const qty = over.qty ?? 0.03;
  const limitPrice = over.limitPrice ?? 750;
  const clientOrderId = over.clientOrderId ?? "apex-spy-1";
  const expiresAt = over.expiresAt ?? EXPIRES;
  const ticket: PaperLimitTicket = {
    symbol: "SPY", side, orderType: "limit", timeInForce: "day", qty, limitPrice, session: "REGULAR", clientOrderId, expiresAt, exitAuthorizationId: null,
  };
  const gate = issueGateProof(
    { singleUseId: clientOrderId, symbol: "SPY", side, qty, limitPrice },
    { dataIntegrityOk: over.dataIntegrityOk ?? true, riskOk: over.riskOk ?? true, notional: over.notional ?? Math.min(qty * limitPrice, 24) },
    new Date(at),
    GATE,
  );
  if (!gate) throw new Error("test failed to build a gate proof");
  const approval = purpose === "STOP"
    ? signStop({
        clientOrderId,
        symbol: "SPY",
        side: "sell",
        orderType: orderType === "stop_limit" ? "stop_limit" : "stop",
        qty,
        limitPrice,
        stopPrice: over.stopPrice ?? 740,
        session: "REGULAR",
        expiresAt,
        linkedEntryId: over.linkedEntryId ?? "apex-spy-1",
      })
    : signLimit(ticket);
  return {
    decisionId: "d1",
    clientOrderId,
    strategyId: "connectivity",
    strategyVersion: "v1",
    strategyApproved: over.strategyApproved ?? false,
    symbol: "SPY" as const,
    side,
    orderType,
    purpose,
    qty,
    limitPrice,
    stopPrice: purpose === "STOP" ? (over.stopPrice ?? 740) : null,
    session: "REGULAR" as const,
    timeInForce: "day" as const,
    expiresAt,
    nonce: over.nonce ?? "n1",
    evidenceTimestamp: new Date(at).toISOString(),
    category: over.category ?? "CONNECTIVITY_TEST",
    sizedNotional: over.sizedNotional ?? qty * limitPrice,
    authorizationRef: "op-1",
    linkedEntryId: purpose === "ENTRY" ? null : (over.linkedEntryId ?? "apex-spy-1"),
    approval,
    gateProof: gate as GateProof,
  };
}

class FakeMarket {
  submits = 0;
  uncertain = false;
  orders = new Map<string, Record<string, unknown>>();

  transport(): ExecutorTransport {
    return {
      kind: "mock",
      call: async (input) => {
        const url = new URL(input.url);
        if (input.method === "GET") {
          const id = url.searchParams.get("client_order_id") ?? "";
          const row = this.orders.get(id);
          return row ? { status: 200, body: row } : { status: 404, body: null };
        }
        if (input.method !== "POST") throw new Error(`unexpected ${input.method}`);
        this.submits += 1;
        const body = input.body as { client_order_id: string; qty: number; side: string; symbol: string };
        const row = {
          id: `brk-${body.client_order_id}`,
          client_order_id: body.client_order_id,
          symbol: body.symbol,
          side: body.side,
          status: "accepted",
          qty: String(body.qty),
          filled_qty: "0",
          filled_avg_price: null,
        };
        this.orders.set(body.client_order_id, row);
        if (this.uncertain) throw new Error("socket timeout");
        return { status: 200, body: row };
      },
    };
  }

  lookup(id: string): BrokerOrder | null {
    const row = this.orders.get(id);
    return row ? orderFromBroker(row) : null;
  }
}

async function setup(snapshot: MarketSnapshot = flatSnapshot(NOW), kill = false) {
  const dir = mkdtempSync(join(tmpdir(), "apex-ex-"));
  let current = snapshot;
  const evidence: EvidenceSource = { kind: "mock", load: async () => current };
  const paths = { journalPath: join(dir, "orders.jsonl"), hermesPath: join(dir, "hermes.json") };
  const exec = new Executor({ ...paths, evidence, operatorSecret: OPERATOR, gateSecret: GATE, killSwitch: kill, redact: [OPERATOR, GATE] });
  await exec.recover(async () => null);
  return {
    dir,
    paths,
    exec,
    evidence,
    setSnapshot(next: MarketSnapshot) { current = next; },
  };
}

test("mode defaults stay frozen and LIVE cannot be selected from paper success", () => {
  assert.equal(MODE_GATE.mode, "PAPER_READ_ONLY");
  assert.equal(MODE_GATE.paperPost, "DISABLED");
  assert.equal(MODE_GATE.livePost, "DISABLED");
  assert.equal(MODE_GATE.autonomousStrategyTrading, "DISABLED");
  assert.equal(MODE_GATE.strategyApproved, false);
  assert.throws(() => { (MODE_GATE as { paperPost: string }).paperPost = "ENABLED"; });
  assert.equal(liveSelectionBlocked().blocked, true);
  assert.equal(architectureReadiness().length, 6);
  assert.equal(ROLES.length, 13);
  const names = Object.getOwnPropertyNames(Executor.prototype);
  assert.equal(names.includes("enableLive"), false);
  assert.equal(names.includes("issueOperatorAuthorization"), false);
  assert.equal(names.includes("generateSignal"), false);
  const runtime = readFileSync(new URL("../src/runtime.ts", import.meta.url), "utf8");
  assert.equal(runtime.includes("issueGateProof"), false);
  assert.equal(runtime.includes("createHmac"), false);
});

test("rejects unsigned, bad signature, unauthorized, veto, expiry, replay, and strategy trades", async () => {
  const { exec, paths } = await setup();
  const unsigned = instruction();
  const missing = await exec.handle({ ...unsigned, approval: null }, NOW);
  assert.match(missing.reason, /unsigned|operator-signed|cannot mint/);
  const forged = instruction({ nonce: "n2", clientOrderId: "apex-spy-2" });
  forged.approval = { ...forged.approval, proof: "deadbeef" } as OperatorApproval;
  const bad = await exec.handle(forged, NOW);
  assert.match(bad.reason, /unsigned|proof/);
  const noSecret = new Executor({
    journalPath: join(paths.journalPath, "..", "other.jsonl"),
    hermesPath: join(paths.hermesPath, "..", "other-hermes.json"),
    evidence: { kind: "mock", load: async () => flatSnapshot(NOW) },
    operatorSecret: null,
    gateSecret: null,
  });
  await noSecret.recover(async () => null);
  const unauth = await noSecret.handle(instruction({ nonce: "n3", clientOrderId: "apex-spy-3" }), NOW);
  assert.match(unauth.reason, /cannot mint|fail closed|unsigned/);
  const sigma = await exec.handle(instruction({ nonce: "n4", clientOrderId: "apex-spy-4", dataIntegrityOk: false }), NOW);
  assert.match(sigma.reason, /Sigma/);
  const sentinel = await exec.handle(instruction({ nonce: "n5", clientOrderId: "apex-spy-5", riskOk: false }), NOW);
  assert.match(sentinel.reason, /Sentinel/);
  const expired = await exec.handle(instruction({ nonce: "n6", clientOrderId: "apex-spy-6", expiresAt: "2020-01-01T00:00:00Z" }), NOW);
  assert.match(expired.reason, /expired/);
  const ok = await exec.handle(instruction(), NOW);
  assert.equal(ok.accepted, true);
  assert.equal(ok.submitted, false);
  const replay = await exec.handle(instruction(), NOW);
  assert.equal(replay.reason, "replay");
  const strategy = await exec.handle(instruction({ nonce: "n7", clientOrderId: "apex-spy-7", strategyApproved: true }), NOW);
  assert.match(strategy.reason, /strategy approval/);
  const trade = await exec.handle(instruction({ nonce: "n8", clientOrderId: "apex-spy-8", category: "STRATEGY_TRADE" }), NOW);
  assert.match(trade.reason, /STRATEGY_TRADE/);
  const journal = readFileSync(paths.journalPath, "utf8");
  assert.equal(journal.includes(OPERATOR), false);
  assert.equal(journal.includes(GATE), false);
});

test("PAPER_READ_ONLY blocks POST and LIVE stays blocked after a paper mock exercise", async () => {
  const { exec } = await setup();
  const market = new FakeMarket();
  const accepted = await exec.handle(instruction(), NOW);
  assert.equal(accepted.accepted, true);
  const blocked = await exec.submit("apex-spy-1", market.transport(), null, NOW);
  assert.equal(blocked.submitted, false);
  assert.match(blocked.reason, /PAPER POST DISABLED/);
  assert.equal(market.submits, 0);
  const alpaca = createAlpacaPaperTransport({ keyId: "PKPAPERKEY123", secret: "secretvalue1" });
  const still = await exec.submit("apex-spy-1", alpaca, signGrant("PAPER_POST"), NOW);
  assert.equal(still.submitted, false);
  assert.match(still.reason, /PAPER POST DISABLED/);
  const sent = await exec.submit("apex-spy-1", market.transport(), signGrant("PAPER_POST"), NOW);
  assert.equal(sent.submitted, true);
  assert.equal(sent.state, "accepted");
  assert.equal(market.submits, 1);
  assert.equal(sent.paperTestsPassed, true);
  const live = exec.submitLive(signGrant("LIVE_POST"), NOW);
  assert.equal(live.submitted, false);
  assert.equal(live.reason, "LIVE POST DISABLED");
  assert.equal(live.paperTestsPassed, true);
  assert.equal(MODE_GATE.livePost, "DISABLED");
  assert.equal(MODE_GATE.mode, "PAPER_READ_ONLY");
  assert.equal(market.submits, 1);
});

test("risk limits reject size, duplicates, positions, halts, closed markets, and the kill switch", async () => {
  const { exec, setSnapshot } = await setup();
  const oversized = await exec.handle(instruction({ qty: 1, limitPrice: 100, notional: 10, sizedNotional: 10, nonce: "big", clientOrderId: "apex-spy-big" }), NOW);
  assert.match(oversized.reason, /\$25/);
  const first = await exec.handle(instruction(), NOW);
  assert.equal(first.accepted, true);
  const duplicate = await exec.handle(instruction({ nonce: "n2", clientOrderId: "apex-spy-2" }), NOW);
  assert.match(duplicate.reason, /duplicate/);
  const fresh = await setup();
  fresh.setSnapshot(flatSnapshot(NOW, { positions: [{ symbol: "SPY", qty: 1 }] }));
  const symbolCap = await fresh.exec.handle(instruction({ nonce: "n3", clientOrderId: "apex-spy-3" }), NOW);
  assert.match(symbolCap.reason, /per-symbol/);
  fresh.setSnapshot(flatSnapshot(NOW, { positions: [{ symbol: "QQQ", qty: 1 }, { symbol: "IWM", qty: 1 }, { symbol: "DIA", qty: 1 }] }));
  const cap = await fresh.exec.handle(instruction({ nonce: "n4", clientOrderId: "apex-spy-4" }), NOW);
  assert.match(cap.reason, /position limit/);
  fresh.setSnapshot(flatSnapshot(NOW, { tradingBlocked: true }));
  const halt = await fresh.exec.handle(instruction({ nonce: "n5", clientOrderId: "apex-spy-5" }), NOW);
  assert.match(halt.reason, /halt/);
  fresh.setSnapshot(flatSnapshot(NOW, { clockOpen: false }));
  const closed = await fresh.exec.handle(instruction({ nonce: "n6", clientOrderId: "apex-spy-6" }), NOW);
  assert.match(closed.reason, /session|clock|eligible/);
  const late = Date.parse("2026-11-16T20:00:00Z");
  fresh.setSnapshot(flatSnapshot(late));
  const cutoff = await fresh.exec.handle(instruction({ at: late, nonce: "n7", clientOrderId: "apex-spy-7", expiresAt: "2026-11-16T22:00:00Z" }), late);
  assert.match(cutoff.reason, /cutoff/);
  fresh.exec.setKill(true);
  fresh.setSnapshot(flatSnapshot(NOW));
  const killed = await fresh.exec.handle(instruction({ nonce: "n8", clientOrderId: "apex-spy-8" }), NOW);
  assert.match(killed.reason, /kill switch/);
});

test("lifecycle covers partial fills, terminal states, and previously authorized exits and stops", async () => {
  const { exec, setSnapshot, paths } = await setup();
  const market = new FakeMarket();
  assert.equal((await exec.handle(instruction(), NOW)).accepted, true);
  assert.equal((await exec.submit("apex-spy-1", market.transport(), signGrant("PAPER_POST"), NOW)).state, "accepted");
  assert.equal(exec.onBroker("apex-spy-1", "partially_filled", 0.01).state, "partial_fill");
  assert.equal(exec.onBroker("apex-spy-1", "filled", 0.03, 749.95).state, "filled");
  assert.equal((await exec.handle(instruction({ nonce: "cxl", clientOrderId: "apex-cxl" }), NOW)).accepted, true);
  assert.equal((await exec.submit("apex-cxl", market.transport(), signGrant("PAPER_POST"), NOW)).state, "accepted");
  assert.equal(exec.onBroker("apex-cxl", "canceled", 0).state, "cancelled");
  assert.equal((await exec.handle(instruction({ nonce: "rej", clientOrderId: "apex-rej" }), NOW)).accepted, true);
  assert.equal((await exec.submit("apex-rej", market.transport(), signGrant("PAPER_POST"), NOW)).state, "accepted");
  assert.equal(exec.onBroker("apex-rej", "rejected", 0).state, "rejected");
  assert.equal((await exec.handle(instruction({ nonce: "exp", clientOrderId: "apex-exp" }), NOW)).accepted, true);
  assert.equal((await exec.submit("apex-exp", market.transport(), signGrant("PAPER_POST"), NOW)).state, "accepted");
  assert.equal(exec.onBroker("apex-exp", "expired", 0).state, "expired");
  const hermes = new HermesJournal(paths.hermesPath);
  assert.equal(hermes.get("apex-spy-1")?.status, "FILLED");
  assert.match(hermes.get("apex-spy-1")?.recoveryNotes.join(" ") ?? "", /filled/i);
  exec.setKill(true);
  setSnapshot(flatSnapshot(NOW, { clockOpen: false, positions: [{ symbol: "SPY", qty: 0.03 }] }));
  const tooBig = await exec.handle(instruction({ side: "sell", purpose: "EXIT", nonce: "exit-big", clientOrderId: "apex-exit-big", linkedEntryId: "apex-spy-1", qty: 1, limitPrice: 20, notional: 20, sizedNotional: 20 }), NOW);
  assert.match(tooBig.reason, /owned|broker position/);
  const exit = await exec.handle(instruction({ side: "sell", purpose: "EXIT", nonce: "exit-1", clientOrderId: "apex-exit-1", linkedEntryId: "apex-spy-1" }), NOW);
  assert.equal(exit.accepted, true);
  const blockedEntry = await exec.handle(instruction({ nonce: "after-kill", clientOrderId: "apex-after-kill" }), NOW);
  assert.match(blockedEntry.reason, /kill switch/);
  const stop = await exec.handle(instruction({
    side: "sell", purpose: "STOP", orderType: "stop", nonce: "stop-1", clientOrderId: "apex-stop-1",
    linkedEntryId: "apex-spy-1", limitPrice: 740, stopPrice: 739, notional: 22, sizedNotional: 22,
  }), NOW);
  assert.equal(stop.accepted, true);
});

test("uncertain submit reconciles by client_order_id and does not retry", async () => {
  const { exec, paths } = await setup();
  const market = new FakeMarket();
  market.uncertain = true;
  assert.equal((await exec.handle(instruction(), NOW)).accepted, true);
  const grant = signGrant("PAPER_POST");
  const first = await exec.submit("apex-spy-1", market.transport(), grant, NOW);
  assert.equal(market.submits, 1);
  assert.equal(first.state, "accepted");
  assert.match(first.reason, /Not resubmitted|not resubmitted|not retried/i);
  const second = await exec.submit("apex-spy-1", market.transport(), grant, NOW);
  assert.equal(market.submits, 1);
  assert.equal(second.submitted, false);
  assert.match(second.reason, /no blind retry/);
  const hermes = new HermesJournal(paths.hermesPath);
  const notes = hermes.get("apex-spy-1")?.recoveryNotes.join("\n") ?? "";
  assert.match(notes, /no resubmit|no blind retry/i);
});

test("journal replay survives restart and reconciles without a second submit", async () => {
  const { exec, paths, evidence } = await setup();
  const market = new FakeMarket();
  assert.equal((await exec.handle(instruction(), NOW)).accepted, true);
  market.uncertain = true;
  await exec.submit("apex-spy-1", market.transport(), signGrant("PAPER_POST"), NOW);
  assert.equal(market.submits, 1);
  const restarted = new Executor({
    ...paths,
    evidence,
    operatorSecret: OPERATOR,
    gateSecret: GATE,
    redact: [OPERATOR, GATE],
  });
  assert.equal(restarted.health().accepting, false);
  const before = market.submits;
  await restarted.recover(async (id) => market.lookup(id));
  assert.equal(market.submits, before);
  assert.equal(restarted.health().accepting, true);
  assert.equal(restarted.health().reconciliation, "clean");
  assert.equal(restarted.get("apex-spy-1")?.state, "accepted");
  const replay = await restarted.handle(instruction(), NOW);
  assert.equal(replay.reason, "replay");
  const again = await restarted.submit("apex-spy-1", market.transport(), signGrant("PAPER_POST"), NOW);
  assert.equal(again.submitted, false);
  assert.equal(market.submits, before);
  const lines = readFileSync(paths.journalPath, "utf8").trim().split("\n");
  assert.ok(lines.length > 2);
  for (const line of lines) JSON.parse(line);
  assert.equal(readFileSync(paths.journalPath, "utf8").includes(OPERATOR), false);
});

test("live credentials are not loaded and are not echoed", () => {
  const marker = "LIVE-SECRET-MUST-NOT-APPEAR";
  assert.throws(() => assertNoLiveCreds({ APEX_EXECUTOR_LIVE_SECRET: marker }), (error: unknown) => {
    assert.match(error instanceof Error ? error.message : "", /LIVE credentials/);
    assert.equal(String(error).includes(marker), false);
    return true;
  });
  const file = join(mkdtempSync(join(tmpdir(), "apex-live-")), "live.json");
  writeFileSync(file, JSON.stringify({ keyId: "AK", secret: marker }));
  const loaded = loadLiveCredentials(
    { APEX_EXECUTOR_ENABLE_LIVE: "I_ENABLE_LIVE", APEX_EXECUTOR_MODE: "LIVE", APEX_EXECUTOR_LIVE_SECRETS_FILE: file, APEX_EXECUTOR_LIVE_SECRET: marker },
    () => { throw new Error("live file was read"); },
  );
  assert.equal(loaded, null);
  const paper = loadPaperCredentials({ APEX_EXECUTOR_PAPER_KEY_ID: " PKPAPERKEY123 ", APEX_EXECUTOR_PAPER_SECRET: " secretvalue1 " });
  assert.equal(paper?.keyId, "PKPAPERKEY123");
  assert.throws(() => loadPaperCredentials({ APEX_EXECUTOR_PAPER_KEY_ID: "AKLIVEKEY123", APEX_EXECUTOR_PAPER_SECRET: "secretvalue1" }));
});

test("alpaca transports refuse POST without a network call", async () => {
  const paper = createAlpacaPaperTransport({ keyId: "PKPAPERKEY123", secret: "secretvalue1" });
  await assert.rejects(() => paper.call({ method: "POST", url: "https://paper-api.alpaca.markets/v2/orders", headers: {}, body: { symbol: "SPY" } }), /PAPER POST DISABLED/);
  const live = createAlpacaLiveTransport();
  await assert.rejects(() => live.call({ method: "POST", url: "https://api.alpaca.markets/v2/orders", headers: {}, body: {} }), /GET only/);
});

test("health endpoint reports the frozen gate and does not submit", async () => {
  const { exec } = await setup();
  const server = createExecutorServer(exec, "health-token");
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  try {
    const denied = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(denied.status, 401);
    const health = await fetch(`http://127.0.0.1:${port}/health`, { headers: { "x-executor-token": "health-token" } });
    const body = await health.json() as { mode: string; paperPost: string; livePost: string; strategyApproved: boolean; autonomousStrategyTrading: string };
    assert.equal(health.status, 200);
    assert.equal(body.mode, "PAPER_READ_ONLY");
    assert.equal(body.paperPost, "DISABLED");
    assert.equal(body.livePost, "DISABLED");
    assert.equal(body.autonomousStrategyTrading, "DISABLED");
    assert.equal(body.strategyApproved, false);
    assert.equal(JSON.stringify(body).includes(OPERATOR), false);
    const rejected = await fetch(`http://127.0.0.1:${port}/instructions`, {
      method: "POST",
      headers: { "x-executor-token": "health-token", "content-type": "application/json" },
      body: JSON.stringify({ strategyApproved: true }),
    });
    assert.equal(rejected.status, 422);
  } finally {
    server.close();
  }
});

test("read-only Alpaca PAPER account", { skip: process.env.APEX_EXECUTOR_PAPER_KEY_ID && process.env.APEX_EXECUTOR_PAPER_SECRET ? false : "SKIPPED: APEX_EXECUTOR_PAPER_KEY_ID and APEX_EXECUTOR_PAPER_SECRET are not in the environment" }, async () => {
  const creds = loadPaperCredentials(process.env);
  assert.ok(creds);
  const snapshot = await readPaperSnapshot(creds);
  assert.equal(snapshot.evidence.http.account, 200);
  assert.equal(JSON.stringify(snapshot).includes(creds.secret), false);
  assert.equal(JSON.stringify(snapshot).includes(creds.keyId), false);
});
