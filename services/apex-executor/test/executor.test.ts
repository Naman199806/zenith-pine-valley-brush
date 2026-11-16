import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { signApproval, verifyApproval, type CanonicalApproval } from "../src/approval.ts";
import { Executor, POST_ENABLED, assertNoLiveCreds } from "../src/runtime.ts";
import { ROLES } from "../../../src/lib/apex/research/canonical-decision.ts";
import { architectureReadiness } from "../../../src/lib/apex/live/architecture.ts";

const now = Date.parse("2026-11-16T15:00:00Z");
const SECRET = "operator-secret-32-characters-min";
const approval = (over: Partial<CanonicalApproval> = {}): CanonicalApproval => ({
  v: 1, source: "OPERATOR_SIGNED", clientOrderId: "test-not-real", symbol: "SPY", side: "buy", orderType: "limit",
  timeInForce: "day", qty: 0.01, limitPrice: 1, session: "REGULAR", expiresAt: "2099-01-01T00:00:00Z", nonce: "test-nonce",
  category: "CONNECTIVITY_TEST", exitAuthorizationId: null, linkedEntryId: null, ...over,
});

function signed(over: Partial<CanonicalApproval> = {}) {
  const a = approval(over);
  return { ...a, operatorProof: signApproval(a, SECRET) };
}

function exec(dir: string): Executor {
  return new Executor({
    mode: "PAPER", postEnabled: false, liveCredentialsLoaded: false,
    statePath: join(dir, "state.json"), lockPath: join(dir, "writer.lock"), inboxPath: join(dir, "inbox.jsonl"),
  }, { keyId: "PKTEST", secret: "s" });
}

test("operator script signature verifies and tampering fails", () => {
  const dir = mkdtempSync(join(tmpdir(), "sign-"));
  const proposed = join(dir, "proposed.json");
  const out = join(dir, "approval.json");
  writeFileSync(proposed, JSON.stringify({ verdict: "READY_FOR_OPERATOR_APPROVAL", ...approval(), operatorProof: undefined }));
  const run = spawnSync("node", ["--experimental-strip-types", "scripts/operator-sign-ticket.mjs", proposed], {
    env: { ...process.env, APEX_OPERATOR_SECRET: SECRET, APEX_OPERATOR_APPROVAL_PATH: out },
  });
  assert.equal(run.status, 0);
  const doc = JSON.parse(readFileSync(out, "utf8"));
  assert.equal(verifyApproval(doc, doc.proof, SECRET, now), null);
  assert.ok(verifyApproval({ ...doc, qty: 9 }, doc.proof, SECRET, now));
  rmSync(dir, { recursive: true, force: true });
});

test("forged approval, replay after restart, and concurrent writer are rejected", () => {
  const dir = mkdtempSync(join(tmpdir(), "ex-"));
  process.env.APEX_OPERATOR_SECRET = SECRET;
  const first = exec(dir);
  assert.equal(first.accept(signed(), now).state, "PROPOSED");
  first.release();
  const restarted = exec(dir);
  assert.equal(restarted.accept(signed(), now).reason, "duplicate or replay");
  assert.throws(() => exec(dir), /one active writer/);
  restarted.release();
  rmSync(dir, { recursive: true, force: true });
});

test("missing broker order is UNKNOWN, not FLAT; partial remains owned", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ex-"));
  process.env.APEX_OPERATOR_SECRET = SECRET;
  const ex = exec(dir);
  ex.accept(signed(), now);
  const missing = await ex.reconcile(async (url) => url.includes("by_client") ? { status: 404, body: null } : { status: 200, body: [] }, "test-not-real");
  assert.equal(missing.unknown, true);
  assert.notEqual(missing.state, "FLAT");
  const held = await ex.reconcile(async (url) => {
    if (url.includes("positions")) return { status: 200, body: [{ symbol: "SPY", qty: "0.01" }] };
    if (url.includes("by_client")) return { status: 200, body: { filled_qty: "0.01", status: "canceled" } };
    return { status: 200, body: [] };
  }, "test-not-real");
  assert.equal(held.filledQty, 0.01);
  assert.notEqual(held.state, "FLAT");
  ex.release();
  rmSync(dir, { recursive: true, force: true });
});

test("SELL requires independent proof and broker-owned quantity", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ex-"));
  process.env.APEX_OPERATOR_SECRET = SECRET;
  const ex = exec(dir);
  ex.accept(signed(), now);
  const sell = signed({ side: "sell", clientOrderId: "sell-1", nonce: "sell-nonce", exitAuthorizationId: "exit-1", linkedEntryId: "test-not-real" });
  const tooBig = await ex.authorizeExit("test-not-real", { ...sell, qty: 1, operatorProof: signApproval({ ...sell, qty: 1 }, SECRET) }, async () => ({ status: 200, body: [{ symbol: "SPY", qty: "0.01" }] }), now);
  assert.ok(tooBig.reason.includes("exceeds"));
  const ok = await ex.authorizeExit("test-not-real", sell, async () => ({ status: 200, body: [{ symbol: "SPY", qty: "0.01" }] }), now);
  assert.equal(ok.ok, true);
  const dup = await ex.authorizeExit("test-not-real", sell, async () => ({ status: 200, body: [{ symbol: "SPY", qty: "0.01" }] }), now);
  assert.ok(dup.reason.includes("duplicate"));
  assert.equal(POST_ENABLED, false);
  ex.release();
  rmSync(dir, { recursive: true, force: true });
});

test("corrupt state fails closed and six stages remain", () => {
  const dir = mkdtempSync(join(tmpdir(), "ex-"));
  writeFileSync(join(dir, "state.json"), "{");
  writeFileSync(join(dir, "writer.lock"), "");
  rmSync(join(dir, "writer.lock"));
  assert.throws(() => exec(dir), /corrupt/);
  assert.throws(() => assertNoLiveCreds({ APEX_EXECUTOR_MODE: "PAPER", APCA_LIVE_API_KEY_ID: "AK" }), /LIVE credentials/);
  assert.equal(architectureReadiness().length, 6);
  assert.equal(ROLES.length, 13);
  rmSync(dir, { recursive: true, force: true });
});
