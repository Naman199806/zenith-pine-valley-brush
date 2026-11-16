import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ingestOutcomes } from "../../../src/lib/apex/research/hermes-outcomes.ts";
import { FILL_EVENT_VERSION, fillEventFromBroker, validateFillEvent, type FillEvent } from "../src/fill-event.ts";
import { Executor, openMarket, type ExecutorConfig } from "../src/runtime.ts";
import { issueGateProof } from "../../../src/lib/apex/live/executor.ts";
import { signApproval, type CanonicalApproval } from "../src/approval.ts";

const now = Date.parse("2026-11-16T15:00:00Z");
const SECRET = "operator-secret-32-characters-min";
const GATE = "gate-secret-value-32-characters-ok";

function event(over: Partial<FillEvent> = {}): FillEvent {
  return {
    v: 1,
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
  assert.match(validateFillEvent(event({ eventTimestamp: "" })) ?? "", /eventTimestamp/);
  assert.match(validateFillEvent(event({ provenance: "mock", source: "PAPER", venue: "alpaca-paper" })) ?? "", /cannot be broker evidence/);
  assert.equal(validateFillEvent(event({ provenance: "mock", source: "MOCK", venue: "mock", brokerOrderId: null, fillId: null })), null);
});

test("partial fills are deltas from broker fields, and mocks are not broker evidence", () => {
  const body = { id: "brk-1", fill_id: "f1", filled_qty: "0.01", filled_avg_price: "100", fee: "0.01", filled_at: "2026-11-16T15:01:00Z" };
  const mock = fillEventFromBroker({
    decisionId: "d1", strategyVersion: "v1", clientOrderId: "c1", symbol: "SPY", side: "buy",
    intendedPrice: 100, previousFilled: 0, body, provenance: "mock", source: "PAPER",
  });
  assert.ok(mock);
  assert.equal(mock?.source, "MOCK");
  assert.equal(mock?.provenance, "mock");
  assert.equal(mock?.brokerOrderId, null);
  assert.equal(mock?.qty, 0.01);
  const more = fillEventFromBroker({
    decisionId: "d1", strategyVersion: "v1", clientOrderId: "c1", symbol: "SPY", side: "buy",
    intendedPrice: 100, previousFilled: 0.01, body: { ...body, fill_id: "f2", filled_qty: "0.02" }, provenance: "mock", source: "PAPER",
  });
  assert.equal(more?.qty, 0.01);
  const broker = fillEventFromBroker({
    decisionId: "d1", strategyVersion: "v1", clientOrderId: "c1", symbol: "SPY", side: "buy",
    intendedPrice: 100, previousFilled: 0, body, provenance: "broker", source: "PAPER",
  });
  assert.equal(broker?.source, "PAPER");
  assert.equal(broker?.brokerOrderId, "brk-1");
  assert.equal(broker?.fillId, "f1");
  assert.equal(fillEventFromBroker({
    decisionId: "d1", strategyVersion: "v1", clientOrderId: "c1", symbol: "SPY", side: "buy",
    intendedPrice: 100, previousFilled: 0, body: { ...body, fill_id: undefined }, provenance: "broker", source: "PAPER",
  }), null);
  const report = ingestOutcomes([
    { decisionId: mock!.decisionId, strategyVersion: mock!.strategyVersion, clientOrderId: mock!.clientOrderId, symbol: "SPY", side: "buy", qty: mock!.qty, fillPrice: mock!.fillPrice, intendedPrice: mock!.intendedPrice, fee: mock!.fee, source: "MOCK", brokerOrderId: null, fillId: null, corrected: false, at: "2026-11-16T15:01:00Z" },
  ], []);
  assert.equal(report.mockIgnored, 1);
  assert.equal(report.paper.length, 0);
});

test("executor records a mock partial fill without calling it broker evidence", async () => {
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
  const body = { id: "brk-1", fill_id: "f1", filled_qty: "0.01", status: "partially_filled", filled_avg_price: "100", fee: "0.01", filled_at: "2026-11-16T15:01:00Z" };
  await ex.reconcile(async (url) => {
    if (url.includes("by_client")) return { status: 200, body };
    if (url.includes("/v2/positions")) return { status: 200, body: [{ symbol: "SPY", qty: "0.01" }] };
    return { status: 200, body: [{}] };
  }, "fill-buy");
  const fills = ex.fillEvents();
  assert.equal(fills.length, 1);
  assert.equal(fills[0]?.v, 1);
  assert.equal(fills[0]?.qty, 0.01);
  assert.equal(fills[0]?.provenance, "mock");
  assert.equal(fills[0]?.source, "MOCK");
  assert.equal(JSON.parse(readFileSync(join(dir, "fills.jsonl"), "utf8")).source, "MOCK");
  assert.equal(ex.get("fill-buy")?.state, "PARTIAL");
  assert.equal(ex.get("fill-buy")?.submitted, false);
  ex.release();
  rmSync(dir, { recursive: true, force: true });
});
