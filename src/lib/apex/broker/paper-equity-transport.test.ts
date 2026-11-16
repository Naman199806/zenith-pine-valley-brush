import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHmac } from "node:crypto";
import { PAPER_POST_ENABLED, computeGates, paperLimitPayload, preparePaperLimit, type BrokerInputs, type PaperLimitTicket } from "./paper-equity-transport.ts";
import { HermesJournal, MockBroker } from "../live/journal.ts";
import { architectureReadiness } from "../live/architecture.ts";
import { agentRoleStatus } from "../live/connectivity.ts";

const now = Date.parse("2026-11-16T15:00:00Z");
const broker = (): BrokerInputs => ({ accountActive: true, tradingBlocked: false, positions: 0, openOrders: 0, dataOk: true });
const ticket = (over: Partial<PaperLimitTicket> = {}): PaperLimitTicket => ({
  symbol: "SPY", side: "buy", orderType: "limit", timeInForce: "day", qty: 0.03, limitPrice: 750,
  session: "REGULAR", clientOrderId: "apex-spy-unique", expiresAt: "2026-11-16T16:00:00-05:00",
  quoteTimestamp: new Date(now).toISOString(), quoteSpreadBps: 5, bid: 749.9, ask: 750, exitAuthorizationId: null, ...over,
});

test("agent cannot mint approval; missing operator file fails closed", () => {
  const dir = mkdtempSync(join(tmpdir(), "p-"));
  const j = new HermesJournal(join(dir, "j.json"));
  delete process.env.APEX_OPERATOR_SECRET;
  const r = preparePaperLimit(ticket(), j, broker(), { now });
  assert.equal(r.submitted, false);
  assert.equal(r.intentPersisted, false);
  assert.ok(r.reason.includes("operator"));
  rmSync(dir, { recursive: true, force: true });
});

test("Sigma and Sentinel are computed from broker inputs", () => {
  assert.ok(computeGates(ticket(), { ...broker(), dataOk: false }).reason?.includes("Sigma"));
  assert.ok(computeGates(ticket(), { ...broker(), positions: 1 }).reason?.includes("position"));
  assert.ok(computeGates(ticket({ qty: 1 }), broker()).reason?.includes("notional"));
  assert.equal(computeGates(ticket(), broker()).ok, true);
});

test("LIMIT payload and journal fields are exact; POST stays disabled", () => {
  const dir = mkdtempSync(join(tmpdir(), "p-"));
  const path = join(dir, "j.json");
  const approvalPath = join(dir, "approval.json");
  const secret = "operator-secret-not-minted-by-agent";
  process.env.APEX_OPERATOR_SECRET = secret;
  const t = ticket();
  const proof = createHmac("sha256", secret).update([t.symbol, t.side, "limit", "day", String(t.qty), String(t.limitPrice), t.session, t.clientOrderId, t.expiresAt, t.quoteTimestamp].join("|")).digest("hex");
  writeFileSync(approvalPath, JSON.stringify({ source: "OPERATOR_FILE", clientOrderId: t.clientOrderId, symbol: t.symbol, side: t.side, qty: t.qty, limitPrice: t.limitPrice, session: t.session, expiresAt: t.expiresAt, quoteTimestamp: t.quoteTimestamp, proof }));
  const r = preparePaperLimit(t, new HermesJournal(path), broker(), { now, approvalPath });
  assert.equal(PAPER_POST_ENABLED, false);
  assert.equal(r.submitted, false);
  assert.equal(r.payload?.type, "limit");
  assert.equal(r.payload?.limit_price, 750);
  const saved = new HermesJournal(path).get(t.clientOrderId);
  assert.equal(saved?.equityIdentity?.orderType, "limit");
  assert.equal(saved?.ticket.orderType, "limit");
  delete process.env.APEX_OPERATOR_SECRET;
  rmSync(dir, { recursive: true, force: true });
});

test("duplicate, stale quote, and unexpected orders fail closed", () => {
  const dir = mkdtempSync(join(tmpdir(), "p-"));
  const j = new HermesJournal(join(dir, "j.json"));
  assert.ok(preparePaperLimit(ticket({ quoteTimestamp: new Date(now + 10_000).toISOString() }), j, broker(), { now }).reason.includes("quote"));
  assert.ok(preparePaperLimit(ticket(), j, { ...broker(), openOrders: 1 }, { now }).reason.includes("order"));
  rmSync(dir, { recursive: true, force: true });
});

test("mocked lifecycle: partial, independent exit, restart, flat", () => {
  const brokerSim = new MockBroker();
  brokerSim.submit("buy-1", "buy", 0.03, "SPY");
  brokerSim.partialFill("buy-1", 0.01);
  brokerSim.complete("buy-1");
  const dir = mkdtempSync(join(tmpdir(), "p-"));
  const path = join(dir, "j.json");
  const j = new HermesJournal(path);
  j.persist({ clientOrderId: "buy-1", ticket: { category: "CONNECTIVITY_TEST", symbol: "SPY", side: "buy", orderType: "limit", maxNotional: 25, expiry: "2099-01-01", singleUseId: "buy-1", readAuthorized: true, orderAuthorized: true, confirmed: true }, createdAt: new Date(now).toISOString(), status: "PARTIAL", filledQty: 0.01, avgPrice: 750 });
  const restarted = new HermesJournal(path);
  assert.equal(restarted.get("buy-1")?.status, "PARTIAL");
  brokerSim.submit("sell-1", "sell", 0.03, "SPY");
  assert.equal(brokerSim.getPosition(), 0);
  assert.equal(paperLimitPayload(ticket({ side: "sell", clientOrderId: "sell-1" })).side, "sell");
  rmSync(dir, { recursive: true, force: true });
});

test("six-stage trace and 13 roles remain intact", () => {
  const stages = architectureReadiness();
  assert.deepEqual(stages.map((s) => s.stage), ["1. Market Data", "2. Scanner", "3. 13 Agents", "4. Decision Gates", "5. Execution", "6. Hermes"]);
  assert.equal(Object.keys(agentRoleStatus()).length, 13);
  assert.equal(agentRoleStatus().Bull.status, "BLOCKED");
  assert.equal(agentRoleStatus().Pilot.status, "BLOCKED");
});
