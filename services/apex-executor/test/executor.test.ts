import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateInstruction, type TradeInstruction } from "../src/instruction.ts";
import { Executor, POST_ENABLED, activationAllowed, assertNoLiveCreds } from "../src/runtime.ts";
import { transitionPosition } from "../src/lifecycle.ts";
import { ROLES } from "../../../src/lib/apex/research/canonical-decision.ts";
import { architectureReadiness } from "../../../src/lib/apex/live/architecture.ts";

const now = Date.parse("2026-11-16T15:00:00Z");
const msg = (over: Partial<TradeInstruction> = {}): TradeInstruction => ({
  decisionId: "d1", clientOrderId: "apex-spy-1", strategyId: "etf-xs-breakout-20-v1", strategyVersion: "v1",
  strategyApproved: false, symbol: "SPY", side: "buy", orderType: "limit", qty: 0.03, limitPrice: 750,
  session: "REGULAR", timeInForce: "day", expiresAt: "2026-11-16T16:00:00-05:00", evidenceTimestamp: new Date(now).toISOString(),
  sigmaApproved: true, sentinelApproved: true, sizedNotional: 22.5, category: "CONNECTIVITY_TEST", authorizationRef: "op-1", nonce: "n1", ...over,
});

test("invalid, vetoed, expired and strategy-trade instructions are rejected", () => {
  assert.ok(validateInstruction(msg({ sigmaApproved: false }), now));
  assert.ok(validateInstruction(msg({ category: "STRATEGY_TRADE" }), now));
  assert.ok(validateInstruction(msg({ expiresAt: "2020-01-01T00:00:00Z" }), now));
  assert.ok(validateInstruction(msg({ authorizationRef: null }), now));
});

test("duplicate replay is rejected and POST stays disabled", () => {
  const dir = mkdtempSync(join(tmpdir(), "ex-"));
  const ex = new Executor({ mode: "PAPER", postEnabled: false, liveCredentialsLoaded: false, journalPath: join(dir, "j.jsonl") }, { keyId: "PKTEST", secret: "s" });
  assert.equal(ex.accept(msg(), now).accepted, true);
  assert.equal(ex.accept(msg(), now).reason, "duplicate or replay");
  assert.equal(POST_ENABLED, false);
});

test("mocked BUY fill, independent SELL, flat, unknown and kill switch", () => {
  const dir = mkdtempSync(join(tmpdir(), "ex-"));
  const ex = new Executor({ mode: "PAPER", postEnabled: false, liveCredentialsLoaded: false, journalPath: join(dir, "j.jsonl") }, { keyId: "PKTEST", secret: "s" });
  ex.accept(msg(), now);
  assert.equal(ex.onBroker("apex-spy-1", "partially_filled", 0.01).state, "PARTIAL");
  assert.equal(ex.onBroker("apex-spy-1", "filled", 0.03).state, "OPEN");
  assert.equal(ex.authorizeExit("apex-spy-1", "sell-1").state, "EXIT_PENDING");
  assert.equal(ex.onBroker("apex-spy-1", "filled", 0.03).state, "CLOSED");
  ex.accept(msg({ clientOrderId: "u1", nonce: "u1" }), now);
  assert.equal(ex.onBroker("u1", "unknown", 0).unknown, true);
  ex.entriesBlocked = true;
  assert.ok(ex.accept(msg({ clientOrderId: "b2", nonce: "b2" }), now).reason.includes("kill switch"));
});

test("PAPER/LIVE isolation and activation is not a single env flag", () => {
  assert.throws(() => assertNoLiveCreds({ APEX_EXECUTOR_MODE: "PAPER", APCA_LIVE_API_KEY_ID: "AK" }), /LIVE credentials/);
  assert.ok(activationAllowed({ APEX_EXECUTOR_POST: "true" }));
  assert.equal(transitionPosition("FLAT", "ENTRY_PENDING"), "ENTRY_PENDING");
});

test("six stages and 13 roles remain", () => {
  assert.equal(architectureReadiness().length, 6);
  assert.equal(ROLES.length, 13);
});
