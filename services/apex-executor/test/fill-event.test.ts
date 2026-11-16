import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ingestOutcomes } from "../../../src/lib/apex/research/hermes-outcomes.ts";
import { issueGateProof } from "../../../src/lib/apex/live/executor.ts";
import { signApproval, type CanonicalApproval } from "../src/approval.ts";
import { FILL_EVENT_VERSION, fillsFromExecutions, toResearchOutcome, trustedEvidence, validateFillEvent, type FillEvent } from "../src/fill-event.ts";
import { Executor, openMarket, type ExecutorConfig } from "../src/runtime.ts";

const now = Date.parse("2026-11-16T15:00:00Z");
const SECRET = "operator-secret-32-characters-min";
const GATE = "gate-secret-value-32-characters-ok";

function event(over: Partial<FillEvent> = {}): FillEvent {
  return {
    v: 1,
    status: "COMPLETE",
    decisionId: "d1",
    strategyVersion: "v1",
    clientOrderId: "c1",
    brokerOrderId: "brk-1",
    fillId: "fill-1",
    symbol: "SPY",
    side: "buy",
    qty: 0.01,
    fillPrice: 100,
    intendedPrice: 100,
    fee: 0.01,
    venue: "alpaca-paper",
    source: "PAPER",
    eventTimestamp: "2026-11-16T15:01:00Z",
    at: "2026-11-16T15:01:00Z",
    provenance: "broker",
    ...over,
  };
}

test("fill contract accepts a versioned broker event and rejects gaps", () => {
  assert.equal(FILL_EVENT_VERSION, 1);
  assert.equal(validateFillEvent(event()), null);
  assert.match(validateFillEvent(event({ v: 2 as 1 })) ?? "", /version/);
  assert.match(validateFillEvent(event({ fillId: null })) ?? "", /fillId/);
  assert.match(validateFillEvent(event({ fee: Number.NaN })) ?? "", /fee/);
  assert.match(validateFillEvent(event({ at: "", eventTimestamp: "" })) ?? "", /at|eventTimestamp/);
  assert.match(validateFillEvent(event({ provenance: "mock", source: "PAPER", venue: "alpaca-paper" })) ?? "", /cannot be broker evidence/);
  const outcome = toResearchOutcome(event());
  assert.equal(outcome.at, event().at);
  assert.equal(trustedEvidence([event()]).length, 1);
  assert.equal(trustedEvidence([event({ provenance: "mock", source: "MOCK", venue: "mock", brokerOrderId: null, fillId: null })]).length, 0);
});

test("partial fills keep each execution price and incomplete records invent nothing", () => {
  const extracted = fillsFromExecutions({
    decisionId: "d1", strategyVersion: "v1", clientOrderId: "c1", symbol: "SPY", side: "buy",
    intendedPrice: 100, provenance: "broker", source: "PAPER",
    body: {
      filled_qty: "0.02",
      filled_avg_price: "999",
      executions: [
        { id: "f1", order_id: "brk-1", qty: "0.01", price: "100", fee: "0.01", transaction_time: "2026-11-16T15:01:00Z" },
        { id: "f2", order_id: "brk-1", qty: "0.01", price: "110", fee: "0.02", transaction_time: "2026-11-16T15:02:00Z" },
      ],
    },
  });
  assert.equal(extracted.incomplete.length, 0);
  assert.deepEqual(extracted.events.map((row) => row.fillPrice), [100, 110]);
  assert.deepEqual(extracted.events.map((row) => row.qty), [0.01, 0.01]);
  assert.ok(extracted.events.every((row) => row.fillPrice !== 999));
  const missing = fillsFromExecutions({
    decisionId: "d1", strategyVersion: "v1", clientOrderId: "c1", symbol: "SPY", side: "buy",
    intendedPrice: 100, provenance: "broker", source: "PAPER",
    body: { filled_qty: "0.01", filled_avg_price: "100", fee: "0.01", filled_at: "2026-11-16T15:01:00Z", id: "brk-1" },
  });
  assert.equal(missing.events.length, 0);
  assert.equal(missing.incomplete[0]?.status, "INCOMPLETE");
  assert.match(missing.incomplete[0]?.reason ?? "", /execution-level/);
  const noFee = fillsFromExecutions({
    decisionId: "d1", strategyVersion: "v1", clientOrderId: "c1", symbol: "SPY", side: "buy",
    intendedPrice: 100, provenance: "broker", source: "PAPER",
    body: { executions: [{ id: "f1", order_id: "brk-1", qty: "0.01", price: "100", transaction_time: "2026-11-16T15:01:00Z" }] },
  });
  assert.equal(noFee.events.length, 0);
  assert.match(noFee.incomplete[0]?.reason ?? "", /fee/);
  const report = ingestOutcomes(extracted.events.map(toResearchOutcome), trustedEvidence(extracted.events));
  assert.equal(report.paper.length, 1);
  assert.equal(report.paper[0]?.openQty, 0.02);
});

test("executor records execution prices and leaves a cumulative average incomplete", async () => {
  process.env.APEX_OPERATOR_SECRET = SECRET;
  process.env.APEX_GATE_SECRET = GATE;
  const dir = mkdtempSync(join(tmpdir(), "fill-"));
  const config: ExecutorConfig = {
    mode: "PAPER", postEnabled: false, liveCredentialsLoaded: false,
    statePath: join(dir, "state.json"), lockPath: join(dir, "writer.lock"), inboxPath: join(dir, "inbox.jsonl"),
    journalPath: join(dir, "journal.jsonl"), hermesPath: join(dir, "hermes.json"), fillsPath: join(dir, "fills.jsonl"),
  };
  const base: CanonicalApproval = {
    v: 1, source: "OPERATOR_SIGNED", clientOrderId: "fill-buy", symbol: "SPY", side: "buy", orderType: "limit",
    timeInForce: "day", qty: 0.02, limitPrice: 100, session: "REGULAR", expiresAt: "2099-01-01T00:00:00Z", nonce: "fill-nonce",
    category: "CONNECTIVITY_TEST", exitAuthorizationId: null, linkedEntryId: null,
  };
  const gate = issueGateProof(
    { singleUseId: base.clientOrderId, symbol: "SPY", side: "buy", qty: 0.02, limitPrice: 100 },
    { dataIntegrityOk: true, riskOk: true, notional: 2 },
    new Date(now),
    GATE,
  );
  const ex = new Executor(config, { keyId: "PKTESTKEY1", secret: "paper-secret" });
  ex.observeMarket(openMarket(now), now);
  ex.accept({ ...base, decisionId: "d1", strategyId: "v1", strategyVersion: "v1", strategyApproved: false, evidenceTimestamp: new Date(now).toISOString(), sizedNotional: 2, operatorProof: signApproval(base, SECRET), gateProof: gate }, now);
  const get = async (url: string) => {
    if (url.includes("by_client")) {
      return { status: 200, body: { filled_qty: "0.02", filled_avg_price: "105", status: "filled", executions: [
        { id: "f1", order_id: "brk-1", qty: "0.01", price: "100", fee: "0.01", transaction_time: "2026-11-16T15:01:00Z" },
        { id: "f2", order_id: "brk-1", qty: "0.01", price: "110", fee: "0.02", transaction_time: "2026-11-16T15:02:00Z" },
      ] } };
    }
    if (url.includes("/v2/positions")) return { status: 200, body: [{ symbol: "SPY", qty: "0.02" }] };
    return { status: 200, body: [] };
  };
  await ex.reconcile(get, "fill-buy");
  assert.deepEqual(ex.fillEvents().map((row) => row.fillPrice), [100, 110]);
  assert.equal(ex.fillEvents().every((row) => row.source === "MOCK" && row.provenance === "mock"), true);
  const lines = readFileSync(join(dir, "fills.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line) as { source?: string; fillPrice?: number });
  assert.equal(lines.every((row) => row.source === "MOCK"), true);
  const bareDir = mkdtempSync(join(tmpdir(), "fill-bare-"));
  const bare = new Executor({
    ...config,
    statePath: join(bareDir, "state.json"),
    lockPath: join(bareDir, "writer.lock"),
    inboxPath: join(bareDir, "inbox.jsonl"),
    journalPath: join(bareDir, "journal.jsonl"),
    hermesPath: join(bareDir, "hermes.json"),
    fillsPath: join(bareDir, "fills.jsonl"),
  }, { keyId: "PKTESTKEY1", secret: "paper-secret" });
  bare.observeMarket(openMarket(now), now);
  const other: CanonicalApproval = { ...base, clientOrderId: "bare-buy", nonce: "bare-nonce" };
  const otherGate = issueGateProof(
    { singleUseId: "bare-buy", symbol: "SPY", side: "buy", qty: 0.02, limitPrice: 100 },
    { dataIntegrityOk: true, riskOk: true, notional: 2 },
    new Date(now),
    GATE,
  );
  bare.accept({ ...other, decisionId: "d2", strategyId: "v1", strategyVersion: "v1", strategyApproved: false, evidenceTimestamp: new Date(now).toISOString(), sizedNotional: 2, operatorProof: signApproval(other, SECRET), gateProof: otherGate }, now);
  await bare.reconcile(async (url) => {
    if (url.includes("by_client")) return { status: 200, body: { filled_qty: "0.02", filled_avg_price: "105", status: "filled" } };
    if (url.includes("/v2/positions")) return { status: 200, body: [{ symbol: "SPY", qty: "0.02" }] };
    return { status: 200, body: [] };
  }, "bare-buy", "broker");
  assert.equal(bare.fillEvents().length, 0);
  assert.equal(bare.incompleteFillEvents()[0]?.status, "INCOMPLETE");
  assert.equal(bare.trustedEvidence().length, 0);
  const report = ingestOutcomes(bare.outcomes(), bare.trustedEvidence());
  assert.equal(report.paper.length, 0);
  ex.release();
  bare.release();
  rmSync(dir, { recursive: true, force: true });
  rmSync(bareDir, { recursive: true, force: true });
});
