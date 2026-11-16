import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { issueGateProof } from "../../../src/lib/apex/live/executor.ts";
import { architectureReadiness } from "../../../src/lib/apex/live/architecture.ts";
import { ROLES } from "../../../src/lib/apex/research/canonical-decision.ts";
import { proposedTicket, signApproval, verifyApproval, type CanonicalApproval } from "../src/approval.ts";
import { buildMondaySpyTicket } from "../../../scripts/monday-spy-preflight.mjs";
import { Executor, POST_ENABLED, STRATEGY_APPROVED, assertNoLiveCreds, openMarket, type ExecutorConfig } from "../src/runtime.ts";
import type { TradeInstruction } from "../src/instruction.ts";
import { createExecutorServer } from "../src/main.ts";

const now = Date.parse("2026-11-16T15:00:00Z");
const SECRET = "operator-secret-32-characters-min";
const GATE = "gate-secret-value-32-characters-ok";

function approval(over: Partial<CanonicalApproval> = {}): CanonicalApproval {
  return {
    v: 1, source: "OPERATOR_SIGNED", clientOrderId: "test-not-real", symbol: "SPY", side: "buy", orderType: "limit",
    timeInForce: "day", qty: 0.01, limitPrice: 1, session: "REGULAR", expiresAt: "2099-01-01T00:00:00Z", nonce: "test-nonce",
    category: "CONNECTIVITY_TEST", exitAuthorizationId: null, linkedEntryId: null, ...over,
  };
}

function signed(over: Partial<CanonicalApproval> = {}): TradeInstruction {
  const base = approval(over);
  const gate = issueGateProof(
    { singleUseId: base.clientOrderId, symbol: base.symbol, side: base.side, qty: base.qty, limitPrice: base.limitPrice },
    { dataIntegrityOk: over.category === "STRATEGY_TRADE" ? false : true, riskOk: true, notional: Math.min(base.qty * base.limitPrice, 24) },
    new Date(now),
    GATE,
  );
  if (!gate) throw new Error("test gate proof was not issued");
  return {
    ...base,
    decisionId: "d1",
    strategyId: "connectivity",
    strategyVersion: "v1",
    strategyApproved: false,
    evidenceTimestamp: new Date(now).toISOString(),
    sizedNotional: base.qty * base.limitPrice,
    operatorProof: signApproval(base, SECRET),
    gateProof: gate,
  };
}

function paths(dir: string): ExecutorConfig {
  return {
    mode: "PAPER", postEnabled: false, liveCredentialsLoaded: false,
    statePath: join(dir, "state.json"), lockPath: join(dir, "writer.lock"), inboxPath: join(dir, "inbox.jsonl"),
    journalPath: join(dir, "journal.jsonl"), hermesPath: join(dir, "hermes.json"),
  };
}

function start(dir: string): Executor {
  process.env.APEX_OPERATOR_SECRET = SECRET;
  process.env.APEX_GATE_SECRET = GATE;
  const exec = new Executor(paths(dir), { keyId: "PKTESTKEY1", secret: "paper-secret" });
  exec.observeMarket(openMarket(now), now);
  return exec;
}

test("operator script signature verifies and tampering or an incomplete ticket fails", () => {
  const dir = mkdtempSync(join(tmpdir(), "sign-"));
  const proposed = join(dir, "proposed.json");
  const out = join(dir, "approval.json");
  const ready = { verdict: "READY_FOR_OPERATOR_APPROVAL", ...approval() };
  writeFileSync(proposed, JSON.stringify(ready));
  const run = spawnSync("node", ["--experimental-strip-types", "scripts/operator-sign-ticket.mjs", proposed], {
    cwd: "/workspace",
    env: { ...process.env, APEX_OPERATOR_SECRET: SECRET, APEX_OPERATOR_APPROVAL_PATH: out },
  });
  assert.equal(run.status, 0, run.stderr?.toString());
  const doc = JSON.parse(readFileSync(out, "utf8")) as CanonicalApproval & { proof: string };
  assert.equal(verifyApproval(doc, doc.proof, SECRET, now), null);
  assert.ok(verifyApproval({ ...doc, qty: 9 }, doc.proof, SECRET, now));
  const broken = join(dir, "broken.json");
  const refused = join(dir, "refused.json");
  const { nonce: _nonce, ...withoutNonce } = ready;
  void _nonce;
  writeFileSync(broken, JSON.stringify(withoutNonce));
  const denied = spawnSync("node", ["--experimental-strip-types", "scripts/operator-sign-ticket.mjs", broken], {
    cwd: "/workspace",
    env: { ...process.env, APEX_OPERATOR_SECRET: SECRET, APEX_OPERATOR_APPROVAL_PATH: refused },
  });
  assert.notEqual(denied.status, 0);
  assert.match(denied.stderr.toString(), /incomplete ticket: nonce/);
  assert.equal(existsSync(refused), false);
  rmSync(dir, { recursive: true, force: true });
});

test("preflight synthetic output is a complete ticket and the signer accepts that shape", () => {
  const at = Date.now();
  const ticket = buildMondaySpyTicket({
    ids: { nonce: "synthetic-nonce", clientOrderId: "synthetic-not-a-ticket" },
    clock: { is_open: true, next_close: "2099-01-01T21:00:00Z" },
    account: { status: "ACTIVE", trading_blocked: false, account_blocked: false },
    asset: { tradable: true, fractionable: true },
    positions: [],
    open: [],
    quote: { bp: 100, ap: 100.01, t: new Date(at).toISOString() },
  }, at);
  assert.equal(ticket.verdict, "READY_FOR_OPERATOR_APPROVAL");
  assert.equal(ticket.nonce, "synthetic-nonce");
  assert.equal(ticket.category, "CONNECTIVITY_TEST");
  assert.equal(proposedTicket(ticket).ok, true);
  const missing = { ...ticket, nonce: undefined };
  assert.equal(proposedTicket(missing).ok, false);
});

test("forged approval, sigma veto, replay after restart, and a second writer are rejected", () => {
  const dir = mkdtempSync(join(tmpdir(), "ex-"));
  const first = start(dir);
  const msg = signed();
  assert.equal(first.accept(msg, now).state, "PROPOSED");
  assert.equal(first.submit().reason, "PAPER POST DISABLED");
  assert.equal(first.get(msg.clientOrderId)?.submitted, false);
  const forged = signed({ nonce: "other-nonce", clientOrderId: "other-id" });
  forged.operatorProof = "deadbeef";
  assert.match(first.accept(forged, now).reason, /proof/);
  const veto = signed({ nonce: "veto-nonce", clientOrderId: "veto-id" });
  if (veto.gateProof) veto.gateProof = { ...veto.gateProof, sigmaApproved: false, sigmaVeto: true, proof: veto.gateProof.proof };
  assert.match(first.accept(veto, now).reason, /Sigma|proof/);
  first.release();
  const restarted = start(dir);
  assert.equal(restarted.accept(msg, now).reason, "duplicate or replay");
  assert.throws(() => start(dir), /one active writer/);
  restarted.release();
  rmSync(dir, { recursive: true, force: true });
});

test("a live lock owner is not replaced; a dead owner can be recovered by one process", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lock-"));
  const sleeper = spawn("sleep", ["30"]);
  writeFileSync(join(dir, "writer.lock"), JSON.stringify({ pid: sleeper.pid }));
  assert.throws(() => start(dir), /one active writer/);
  assert.equal(JSON.parse(readFileSync(join(dir, "writer.lock"), "utf8")).pid, sleeper.pid);
  sleeper.kill("SIGKILL");
  await new Promise((resolve) => sleeper.once("exit", resolve));
  const recovered = start(dir);
  assert.equal(JSON.parse(readFileSync(join(dir, "writer.lock"), "utf8")).pid, process.pid);
  assert.throws(() => start(dir), /one active writer/);
  recovered.release();
  writeFileSync(join(dir, "writer.lock"), "{");
  assert.throws(() => start(dir), /not provably dead/);
  rmSync(dir, { recursive: true, force: true });
});

test("PROPOSED stays proposed when the broker has no order; an unconfirmed attempt becomes UNKNOWN, not FLAT", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ex-"));
  const ex = start(dir);
  const msg = signed();
  ex.accept(msg, now);
  const missing = await ex.reconcile(async (url) => url.includes("by_client") ? { status: 404, body: null } : { status: 200, body: [] }, msg.clientOrderId);
  assert.equal(missing.state, "PROPOSED");
  assert.equal(missing.unknown, false);
  ex.noteUnconfirmedAttempt(msg.clientOrderId);
  const unknown = await ex.reconcile(async (url) => url.includes("by_client") ? { status: 404, body: null } : { status: 200, body: [] }, msg.clientOrderId);
  assert.equal(unknown.unknown, true);
  assert.notEqual(unknown.state, "FLAT");
  assert.equal(POST_ENABLED, false);
  assert.equal(STRATEGY_APPROVED, false);
  ex.release();
  rmSync(dir, { recursive: true, force: true });
});

test("partial fill survives cancellation, exit uses broker quantity, restart stays flat", async () => {
  const dir = mkdtempSync(join(tmpdir(), "life-"));
  const ex = start(dir);
  const buy = signed({ qty: 0.02, clientOrderId: "life-buy", nonce: "life-buy" });
  assert.equal(ex.accept(buy, now).state, "PROPOSED");
  const view = (order: { filled_qty: string; status: string }, position: { symbol: string; qty: string }[], open: object[]) => async (url: string) => {
    if (url.includes("by_client")) return { status: 200, body: order };
    if (url.includes("/v2/positions")) return { status: 200, body: position };
    return { status: 200, body: open };
  };
  const partial = await ex.reconcile(view({ filled_qty: "0.01", status: "partially_filled" }, [{ symbol: "SPY", qty: "0.01" }], [{}]), buy.clientOrderId);
  assert.equal(partial.state, "PARTIAL");
  const held = await ex.reconcile(view({ filled_qty: "0.01", status: "canceled" }, [{ symbol: "SPY", qty: "0.01" }], []), buy.clientOrderId);
  assert.equal(held.state, "PARTIAL");
  assert.equal(held.filledQty, 0.01);
  const sell = signed({ side: "sell", qty: 0.02, clientOrderId: "life-sell", nonce: "life-sell", exitAuthorizationId: "exit-1", linkedEntryId: buy.clientOrderId });
  const tooBig = await ex.authorizeExit(buy.clientOrderId, sell, view({ filled_qty: "0", status: "accepted" }, [{ symbol: "SPY", qty: "0.01" }], []), now);
  assert.match(tooBig.reason, /exceeds/);
  const sized = signed({ side: "sell", qty: 0.01, clientOrderId: "life-sell", nonce: "life-sell", exitAuthorizationId: "exit-1", linkedEntryId: buy.clientOrderId });
  const ok = await ex.authorizeExit(buy.clientOrderId, sized, view({ filled_qty: "0", status: "accepted" }, [{ symbol: "SPY", qty: "0.01" }], []), now);
  assert.equal(ok.ok, true);
  const dup = await ex.authorizeExit(buy.clientOrderId, sized, view({ filled_qty: "0", status: "accepted" }, [{ symbol: "SPY", qty: "0.01" }], []), now);
  assert.match(dup.reason, /duplicate/);
  const flat = await ex.reconcile(view({ filled_qty: "0.01", status: "canceled" }, [], []), buy.clientOrderId);
  assert.equal(flat.state, "FLAT");
  ex.release();
  const restarted = start(dir);
  assert.equal(restarted.get(buy.clientOrderId)?.state, "FLAT");
  assert.equal(restarted.accept(buy, now).reason, "duplicate or replay");
  const hermes = readFileSync(join(dir, "hermes.json"), "utf8");
  assert.match(hermes, /life-buy/);
  assert.equal(hermes.includes(SECRET), false);
  restarted.release();
  rmSync(dir, { recursive: true, force: true });
});

test("inbox rejects a bad message, replays a good one, and does not enable POST", () => {
  const dir = mkdtempSync(join(tmpdir(), "in-"));
  const ex = start(dir);
  assert.match(ex.ingest("{", now).reason, /rejected/);
  const msg = signed({ clientOrderId: "inbox-1", nonce: "inbox-nonce" });
  assert.equal(ex.ingest(JSON.stringify(msg), now).state, "PROPOSED");
  assert.equal(ex.ingest(JSON.stringify(msg), now).reason, "duplicate or replay");
  assert.equal(ex.submit().submitted, false);
  ex.release();
  rmSync(dir, { recursive: true, force: true });
});

test("corrupt state fails closed, live credentials are refused, and the six stages remain", () => {
  const dir = mkdtempSync(join(tmpdir(), "bad-"));
  writeFileSync(join(dir, "state.json"), "{");
  assert.throws(() => start(dir), /corrupt/);
  const marker = "LIVE-SECRET-MUST-NOT-APPEAR";
  assert.throws(() => assertNoLiveCreds({ APEX_EXECUTOR_MODE: "PAPER", APCA_LIVE_API_KEY_ID: marker }), (error: unknown) => {
    assert.match(error instanceof Error ? error.message : "", /LIVE credentials/);
    assert.equal(String(error).includes(marker), false);
    return true;
  });
  assert.equal(architectureReadiness().length, 6);
  assert.equal(ROLES.length, 13);
  assert.deepEqual([...ROLES], ["Scout", "Vector", "Atlas", "Oracle", "Pulse", "Volta", "Bull", "Bear", "Sigma", "Sentinel", "Allocator", "Pilot", "Hermes"]);
  rmSync(dir, { recursive: true, force: true });
});

test("health stays on the frozen gate", async () => {
  const dir = mkdtempSync(join(tmpdir(), "health-"));
  const ex = start(dir);
  const server = createExecutorServer(ex, "health-token");
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  try {
    const denied = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(denied.status, 401);
    const res = await fetch(`http://127.0.0.1:${port}/health`, { headers: { "x-executor-token": "health-token" } });
    const body = await res.json() as { mode: string; paperPost: string; livePost: string; strategyApproved: boolean; postEnabled: boolean };
    assert.equal(body.mode, "PAPER_READ_ONLY");
    assert.equal(body.paperPost, "DISABLED");
    assert.equal(body.livePost, "DISABLED");
    assert.equal(body.strategyApproved, false);
    assert.equal(body.postEnabled, false);
    assert.equal(JSON.stringify(body).includes(SECRET), false);
  } finally {
    server.close();
    ex.release();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("mock lifecycle script is explicit that it is not a real fill", () => {
  const run = spawnSync("node", ["--experimental-strip-types", "services/apex-executor/scripts/mock-lifecycle.mjs"], { cwd: "/workspace" });
  assert.equal(run.status, 0, run.stderr?.toString());
  const report = JSON.parse(run.stdout.toString()) as { realFill: boolean; flat: string; partial: string; postEnabled: boolean; note: string };
  assert.equal(report.realFill, false);
  assert.equal(report.partial, "PARTIAL");
  assert.equal(report.flat, "FLAT");
  assert.equal(report.postEnabled, false);
  assert.match(report.note, /does not prove a real fill/);
});
