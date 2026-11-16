import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { issueGateProof } from "../../../src/lib/apex/live/executor.ts";
import { architectureReadiness } from "../../../src/lib/apex/live/architecture.ts";
import { ROLES } from "../../../src/lib/apex/research/canonical-decision.ts";
import { buildProposal } from "../../../src/lib/apex/research/proposal.ts";
import { ingestOutcomes } from "../../../src/lib/apex/research/hermes-outcomes.ts";
import { runCanonicalDecision, type Bar } from "../../../src/lib/apex/research/canonical-decision.ts";
import { proposedTicket, signApproval, verifyApproval, type CanonicalApproval } from "../src/approval.ts";
import { isPidAlive, pidAliveFromKillError } from "../src/lock.ts";
import { FILE_ONLY_DURABILITY_WARNING } from "../src/persist.ts";
import { checkDeployConfig } from "../src/deploy-config.ts";
import { nextPollDelay } from "../src/runtime.ts";
import { boot } from "../src/main.ts";
import { buildMondaySpyTicket } from "../../../scripts/monday-spy-preflight.mjs";
import { Executor, LIVE_POST_ENABLED, PAPER_POST_ENABLED, POST_ENABLED, STRATEGY_APPROVED, assertNoLiveCreds, openMarket, type ExecutorConfig } from "../src/runtime.ts";
import type { TradeInstruction } from "../src/instruction.ts";
import { createExecutorServer } from "../src/main.ts";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
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
    journalPath: join(dir, "journal.jsonl"), hermesPath: join(dir, "hermes.json"), fillsPath: join(dir, "fills.jsonl"),
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
  const run = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/operator-sign-ticket.mjs", proposed], {
    cwd: repoRoot,
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
  const denied = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/operator-sign-ticket.mjs", broken], {
    cwd: repoRoot,
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

function killChild(child: ChildProcess): void {
  if (child.exitCode != null || child.signalCode != null) return;
  try {
    child.kill();
  } catch {
    // already exited
  }
}

function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode != null || child.signalCode != null) return Promise.resolve();
  return new Promise((resolve) => {
    child.once("exit", () => resolve());
    if (child.exitCode != null || child.signalCode != null) resolve();
  });
}

test("EPERM from process.kill means the lock owner is alive", () => {
  const refused = (code: string) => Object.assign(new Error(code), { code });
  assert.equal(pidAliveFromKillError(refused("EPERM")), true);
  assert.equal(pidAliveFromKillError(refused("EINVAL")), true);
  assert.equal(pidAliveFromKillError(refused("EBADF")), true);
  assert.equal(pidAliveFromKillError(new Error("no code")), true);
  assert.equal(pidAliveFromKillError(refused("ESRCH")), false);
  assert.equal(isPidAlive(process.pid), true);
  assert.equal(isPidAlive(0), false);
  assert.equal(isPidAlive(1), false);
  assert.equal(isPidAlive(1.5), false);
});

test("a live lock owner is not replaced; a dead owner can be recovered by one process", { timeout: 20_000 }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "lock-"));
  const child = spawn(process.execPath, ["-e", "setTimeout(()=>{}, 30000)"], { stdio: "ignore", windowsHide: true });
  let recovered: Executor | null = null;
  t.after(async () => {
    recovered?.release();
    killChild(child);
    await Promise.race([waitForExit(child), new Promise((resolve) => setTimeout(resolve, 5_000))]);
    rmSync(dir, { recursive: true, force: true });
  });
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", () => resolve());
    child.once("error", reject);
  });
  assert.equal(typeof child.pid, "number");
  assert.ok(child.pid && child.pid > 1);
  writeFileSync(join(dir, "writer.lock"), JSON.stringify({ pid: child.pid }));
  assert.equal(isPidAlive(child.pid), true);
  assert.throws(() => start(dir), /one active writer/);
  assert.equal(JSON.parse(readFileSync(join(dir, "writer.lock"), "utf8")).pid, child.pid);
  killChild(child);
  await waitForExit(child);
  const deadline = Date.now() + 2_000;
  while (child.pid != null && isPidAlive(child.pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(isPidAlive(child.pid ?? 0), false);
  recovered = start(dir);
  assert.equal(JSON.parse(readFileSync(join(dir, "writer.lock"), "utf8")).pid, process.pid);
  assert.throws(() => start(dir), /one active writer/);
  recovered.release();
  recovered = null;
  writeFileSync(join(dir, "writer.lock"), "{");
  assert.throws(() => start(dir), /not provably dead/);
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
  const notFlat = await ex.reconcile(view({ filled_qty: "0.01", status: "canceled" }, [], []), buy.clientOrderId);
  assert.equal(notFlat.state, "UNKNOWN");
  assert.notEqual(notFlat.state, "FLAT");
  const sellView = (url: string) => {
    if (url.includes("life-sell")) return Promise.resolve({ status: 200, body: { filled_qty: "0.01", status: "filled" } });
    if (url.includes("/v2/positions")) return Promise.resolve({ status: 200, body: [] });
    if (url.includes("/v2/orders")) return Promise.resolve({ status: 200, body: [] });
    return Promise.resolve({ status: 200, body: { filled_qty: "0.01", status: "canceled" } });
  };
  const flatSell = await ex.reconcile(sellView, "life-sell");
  assert.equal(flatSell.state, "FLAT");
  assert.equal(flatSell.clientOrderId, "life-sell");
  assert.notEqual(flatSell.clientOrderId, buy.clientOrderId);
  const flat = ex.get(buy.clientOrderId);
  assert.equal(flat?.state, "FLAT");
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
  assert.equal(readFileSync(join(dir, "state.json"), "utf8"), "{");
  writeFileSync(join(dir, "state.json"), JSON.stringify({ hello: true }));
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
    const body = await res.json() as {
      mode: string;
      paperPost: string;
      livePost: string;
      strategyApproved: boolean;
      postEnabled: boolean;
      directoryFsyncSupported: boolean;
      durability: string;
      durabilityWarning: string | null;
    };
    assert.equal(body.mode, "PAPER_READ_ONLY");
    assert.equal(body.paperPost, "DISABLED");
    assert.equal(body.livePost, "DISABLED");
    assert.equal(body.strategyApproved, false);
    assert.equal(body.postEnabled, false);
    assert.equal(PAPER_POST_ENABLED, false);
    assert.equal(LIVE_POST_ENABLED, false);
    assert.equal(body.directoryFsyncSupported, process.platform !== "win32");
    assert.equal(body.durability, process.platform === "win32" ? "file-only" : "full");
    assert.equal(body.durabilityWarning, process.platform === "win32" ? FILE_ONLY_DURABILITY_WARNING : null);
    assert.equal(JSON.stringify(body).includes(SECRET), false);
  } finally {
    server.close();
    ex.release();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("unsigned research proposals are not executable and a signed handoff stays proposed", () => {
  const bars = (n: number, start = 100): Bar[] => Array.from({ length: n }, (_, i) => {
    const date = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
    return { date, open: start + i, high: start + i + 1, low: start + i - 1, close: start + i };
  });
  const spy = bars(220, 400);
  const trace = runCanonicalDecision({
    strategyVersion: "etf-xs-breakout-20-v1", symbol: "SPY", bars: spy, spyBars: spy,
    asOf: `${spy.at(-1)!.date}T21:00:00Z`, provenance: "test", dataOk: true, proposedNotional: 25,
    broker: { ownedQty: 0, openExitQty: 0, asOf: `${spy.at(-1)!.date}T21:00:00Z` },
  });
  const proposal = buildProposal(trace, 25);
  const dir = mkdtempSync(join(tmpdir(), "hand-"));
  const ex = start(dir);
  assert.match(ex.accept(proposal as never, now).reason, /not executable/);
  const msg = signed({ nonce: proposal.nonce, clientOrderId: "handoff-1" });
  msg.decisionId = proposal.decisionId;
  assert.equal(ex.accept(msg, now).state, "PROPOSED");
  assert.equal(ex.get("handoff-1")?.filledQty, 0);
  assert.equal(ex.get("handoff-1")?.submitted, false);
  ex.release();
  rmSync(dir, { recursive: true, force: true });
});

test("sell fill confirms flat; partial and canceled exits do not", async () => {
  const dir = mkdtempSync(join(tmpdir(), "exit-"));
  const ex = start(dir);
  const buy = signed({ qty: 0.02, clientOrderId: "px-buy", nonce: "px-buy" });
  ex.accept(buy, now);
  const book = {
    orders: { "px-buy": { filled_qty: "0.02", status: "filled" } } as Record<string, { filled_qty: string; status: string }>,
    position: [{ symbol: "SPY", qty: "0.02" }],
    open: [] as object[],
  };
  const get = async (url: string) => {
    if (url.includes("by_client_order_id")) {
      const id = new URL(url).searchParams.get("client_order_id") ?? "";
      const row = book.orders[id];
      return row ? { status: 200, body: row } : { status: 404, body: null };
    }
    if (url.includes("/v2/positions")) return { status: 200, body: book.position };
    return { status: 200, body: book.open };
  };
  assert.equal((await ex.reconcile(get, "px-buy")).state, "OPEN");
  const sell = signed({ side: "sell", qty: 0.01, clientOrderId: "px-sell", nonce: "px-sell", exitAuthorizationId: "exit-px", linkedEntryId: "px-buy" });
  assert.equal((await ex.authorizeExit("px-buy", sell, get, now)).ok, true);
  assert.equal(ex.get("px-sell")?.state, "PROPOSED");
  book.orders["px-sell"] = { filled_qty: "0.005", status: "partially_filled" };
  book.position = [{ symbol: "SPY", qty: "0.015" }];
  assert.equal((await ex.reconcile(get, "px-sell")).state, "PARTIAL");
  assert.notEqual(ex.get("px-buy")?.state, "FLAT");
  book.orders["px-sell"] = { filled_qty: "0.005", status: "canceled" };
  const canceled = await ex.reconcile(get, "px-sell");
  assert.notEqual(canceled.state, "FLAT");
  assert.equal(ex.get("px-buy")?.linkedExitId, null);
  const sell2 = signed({ side: "sell", qty: 0.015, clientOrderId: "px-sell-2", nonce: "px-sell-2", exitAuthorizationId: "exit-px-2", linkedEntryId: "px-buy" });
  assert.equal((await ex.authorizeExit("px-buy", sell2, get, now)).ok, true);
  book.orders["px-sell-2"] = { filled_qty: "0.015", status: "filled" };
  book.position = [];
  const flat = await ex.reconcile(get, "px-sell-2");
  assert.equal(flat.state, "FLAT");
  assert.equal(flat.clientOrderId, "px-sell-2");
  assert.equal(ex.get("px-buy")?.state, "FLAT");
  const report = ingestOutcomes(ex.outcomes(), ex.trustedEvidence());
  assert.equal(report.paper.length, 0);
  assert.equal(report.mockIgnored, ex.outcomes().length);
  ex.release();
  const restarted = start(dir);
  assert.equal(restarted.get("px-buy")?.state, "FLAT");
  assert.equal(restarted.get("px-sell-2")?.state, "FLAT");
  assert.equal(restarted.submit().submitted, false);
  restarted.release();
  rmSync(dir, { recursive: true, force: true });
});

test("disconnect, delayed fill, stale evidence, and unexpected positions fail closed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "edge-"));
  const ex = start(dir);
  const buy = signed({ qty: 0.02, clientOrderId: "edge-buy", nonce: "edge-buy" });
  ex.accept(buy, now);
  const down = await ex.reconcile(async () => { throw new Error("socket down"); }, buy.clientOrderId);
  assert.equal(down.state, "UNKNOWN");
  assert.equal(ex.submit().submitted, false);
  const fresh = start(mkdtempSync(join(tmpdir(), "delay-")));
  fresh.accept(signed({ qty: 0.02, clientOrderId: "delay-buy", nonce: "delay-buy" }), now);
  const step = async (filled: string, position: string, status: string) => fresh.reconcile(async (url) => {
    if (url.includes("by_client")) return { status: 200, body: { filled_qty: filled, status } };
    if (url.includes("/v2/positions")) return { status: 200, body: [{ symbol: "SPY", qty: position }] };
    return { status: 200, body: [] };
  }, "delay-buy");
  assert.equal((await step("0.01", "0.01", "partially_filled")).state, "PARTIAL");
  assert.equal((await step("0.02", "0.02", "filled")).state, "OPEN");
  assert.equal((await step("0.01", "0.02", "filled")).state, "UNKNOWN");
  const odd = start(mkdtempSync(join(tmpdir(), "odd-")));
  odd.accept(signed({ qty: 0.02, clientOrderId: "odd-buy", nonce: "odd-buy" }), now);
  const unexpected = await odd.reconcile(async (url) => {
    if (url.includes("by_client")) return { status: 200, body: { filled_qty: "0.01", status: "partially_filled" } };
    if (url.includes("/v2/positions")) return { status: 200, body: [{ symbol: "SPY", qty: "5" }] };
    return { status: 200, body: [] };
  }, "odd-buy");
  assert.equal(unexpected.state, "UNKNOWN");
  assert.equal(odd.accept(signed({ nonce: "stale", clientOrderId: "stale-buy" }), now + 10_000).reason, "stale broker evidence");
  odd.notePoll("paper read failed");
  odd.notePoll("paper read failed");
  odd.notePoll("paper read failed");
  assert.ok(odd.alerts.includes("prolonged paper read failure"));
  assert.equal(nextPollDelay(1_000, true), 2_000);
  assert.equal(nextPollDelay(16_000, true), 30_000);
  assert.equal(nextPollDelay(30_000, false), 1_000);
  ex.release();
  fresh.release();
  odd.release();
});

test("deployment files match the runtime paths", () => {
  const unit = readFileSync("services/apex-executor/deploy/apex-executor.service", "utf8");
  const env = readFileSync("services/apex-executor/deploy/apex-executor.env.example", "utf8");
  assert.deepEqual(checkDeployConfig(unit, env), []);
});

test("clean shutdown lets the next process take the lock", async () => {
  const dir = mkdtempSync(join(tmpdir(), "boot-"));
  const keys = ["APEX_EXECUTOR_DATA", "APEX_EXECUTOR_STATE", "APEX_EXECUTOR_LOCK", "APEX_EXECUTOR_INBOX", "APEX_EXECUTOR_JOURNAL", "APEX_EXECUTOR_HERMES", "APEX_EXECUTOR_PORT", "APEX_EXECUTOR_HEALTH_TOKEN", "APEX_EXECUTOR_PAPER_KEY_ID", "APEX_EXECUTOR_PAPER_SECRET"] as const;
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.APEX_EXECUTOR_DATA = dir;
  process.env.APEX_EXECUTOR_STATE = join(dir, "state.json");
  process.env.APEX_EXECUTOR_LOCK = join(dir, "writer.lock");
  process.env.APEX_EXECUTOR_INBOX = join(dir, "inbox.jsonl");
  process.env.APEX_EXECUTOR_JOURNAL = join(dir, "journal.jsonl");
  process.env.APEX_EXECUTOR_HERMES = join(dir, "hermes.json");
  process.env.APEX_EXECUTOR_PORT = "0";
  process.env.APEX_EXECUTOR_HEALTH_TOKEN = "local-token";
  delete process.env.APEX_EXECUTOR_PAPER_KEY_ID;
  delete process.env.APEX_EXECUTOR_PAPER_SECRET;
  const running = await boot();
  running.stop();
  const next = start(dir);
  next.release();
  for (const key of keys) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  rmSync(dir, { recursive: true, force: true });
});

test("mock lifecycle script is explicit that it is not a real fill", () => {
  const run = spawnSync(process.execPath, ["--experimental-strip-types", "services/apex-executor/scripts/mock-lifecycle.mjs"], { cwd: repoRoot });
  assert.equal(run.status, 0, run.stderr?.toString());
  const report = JSON.parse(run.stdout.toString()) as { realFill: boolean; flat: string; partial: string; postEnabled: boolean; note: string };
  assert.equal(report.realFill, false);
  assert.equal(report.partial, "PARTIAL");
  assert.equal(report.flat, "FLAT");
  assert.equal(report.postEnabled, false);
  assert.match(report.note, /does not prove a real fill/);
});
