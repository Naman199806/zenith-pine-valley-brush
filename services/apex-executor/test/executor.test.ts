import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHmac } from "node:crypto";
import { instructionMaterial, validateShape, verifyOperatorProof, type TradeInstruction } from "../src/instruction.ts";
import { Executor, POST_ENABLED, assertNoLiveCreds } from "../src/runtime.ts";
import { ROLES } from "../../../src/lib/apex/research/canonical-decision.ts";
import { architectureReadiness } from "../../../src/lib/apex/live/architecture.ts";

const now = Date.parse("2026-11-16T15:00:00Z");
const SECRET = "operator-secret-32-characters-min";
const msg = (over: Partial<TradeInstruction> = {}): TradeInstruction => {
  const base: TradeInstruction = {
    decisionId: "d1", clientOrderId: "apex-spy-1", strategyId: "etf-xs-breakout-20-v1", strategyVersion: "v1",
    strategyApproved: false, symbol: "SPY", side: "buy", orderType: "limit", qty: 0.03, limitPrice: 750,
    session: "REGULAR", timeInForce: "day", expiresAt: "2026-11-16T16:00:00-05:00", evidenceTimestamp: new Date(now).toISOString(),
    sizedNotional: 22.5, category: "CONNECTIVITY_TEST", nonce: "n1", operatorProof: null, exitAuthorizationId: null, ...over,
  };
  base.operatorProof = createHmac("sha256", SECRET).update(instructionMaterial(base)).digest("hex");
  return base;
};

function exec(dir: string, owner = "executor-1"): Executor {
  return new Executor({ mode: "PAPER", postEnabled: false, liveCredentialsLoaded: false, statePath: join(dir, "state.json"), lockPath: join(dir, "writer.lock") }, { keyId: "PKTEST", secret: "s" }, owner);
}

test("forged approval and strategy trade are rejected", () => {
  delete process.env.APEX_OPERATOR_SECRET;
  assert.ok(verifyOperatorProof(msg(), null, now)?.includes("cannot mint"));
  process.env.APEX_OPERATOR_SECRET = SECRET;
  assert.ok(verifyOperatorProof({ ...msg(), operatorProof: "aa" }, SECRET, now)?.includes("mismatch"));
  assert.ok(verifyOperatorProof(msg({ category: "STRATEGY_TRADE" }), SECRET, now)?.includes("STRATEGY_TRADE"));
  assert.ok(validateShape(msg({ side: "sell" }))?.includes("sell"));
});

test("duplicate is blocked after a fresh process restore", () => {
  const dir = mkdtempSync(join(tmpdir(), "ex-"));
  process.env.APEX_OPERATOR_SECRET = SECRET;
  const first = exec(dir);
  assert.equal(first.accept(msg(), now).accepted, true);
  first.release();
  const restarted = exec(dir);
  assert.equal(restarted.accept(msg(), now).reason, "duplicate or replay");
  restarted.release();
  rmSync(dir, { recursive: true, force: true });
});

test("partial BUY then cancel stays owned until broker confirms flat", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ex-"));
  process.env.APEX_OPERATOR_SECRET = SECRET;
  const ex = exec(dir);
  ex.accept(msg(), now);
  const held = await ex.reconcile(async (url) => {
    if (url.includes("positions")) return { status: 200, body: [{ symbol: "SPY", qty: "0.01" }] };
    if (url.includes("orders:by_client")) return { status: 200, body: { filled_qty: "0.01", status: "canceled" } };
    return { status: 200, body: [] };
  }, "apex-spy-1");
  assert.equal(held.state, "OPEN");
  assert.equal(held.filledQty, 0.01);
  const flat = await ex.reconcile(async (url) => url.includes("positions") || url.includes("orders") ? { status: 200, body: [] } : { status: 200, body: { filled_qty: "0" } }, "apex-spy-1");
  assert.equal(flat.state, "FLAT");
  ex.release();
  rmSync(dir, { recursive: true, force: true });
});

test("separate SELL is required and unknown does not retry", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ex-"));
  process.env.APEX_OPERATOR_SECRET = SECRET;
  const ex = exec(dir);
  ex.accept(msg(), now);
  assert.equal(ex.authorizeExit("apex-spy-1", msg({ side: "sell", clientOrderId: "sell-1", nonce: "s1" }), 0.03).ok, false);
  const sell = msg({ side: "sell", clientOrderId: "sell-1", nonce: "s1", exitAuthorizationId: "exit-1" });
  assert.equal(ex.authorizeExit("apex-spy-1", sell, 0.03).ok, true);
  const unknown = await ex.reconcile(async () => ({ status: 500, body: null }), "apex-spy-1");
  assert.equal(unknown.unknown, true);
  assert.equal(ex.alerts.length > 0, true);
  assert.equal(POST_ENABLED, false);
  ex.release();
  rmSync(dir, { recursive: true, force: true });
});

test("one writer per account and PAPER/LIVE isolation", () => {
  const dir = mkdtempSync(join(tmpdir(), "ex-"));
  const first = exec(dir, "writer-a");
  assert.throws(() => exec(dir, "writer-b"), /one active writer/);
  first.release();
  assert.throws(() => assertNoLiveCreds({ APEX_EXECUTOR_MODE: "PAPER", APCA_LIVE_API_KEY_ID: "AK" }), /LIVE credentials/);
  assert.equal(architectureReadiness().length, 6);
  assert.equal(ROLES.length, 13);
  rmSync(dir, { recursive: true, force: true });
});
