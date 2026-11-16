/**
 * Apex Executor runtime.
 * PAPER read-only. POST is hard-disabled.
 * One writer lock. Crash-safe snapshot plus an append-only journal.
 * Broker lookups fail closed. Accepting a proposal stays PROPOSED.
 */

import { closeSync, fsyncSync, mkdirSync, openSync, writeSync } from "node:fs";
import { dirname } from "node:path";
import { PAPER_TRADING_ORIGIN, assertPaperUrl, redactSecrets } from "../../../src/lib/apex/broker/allowlist.ts";
import { assertPaperCreds, type PaperCreds } from "../../../src/lib/apex/broker/paper-read.ts";
import { HermesJournal } from "../../../src/lib/apex/live/journal.ts";
import type { IntentRecord } from "../../../src/lib/apex/live/executor.ts";
import type { ExecutionOutcome } from "../../../src/lib/apex/research/hermes-outcomes.ts";
import { verifyApproval } from "./approval.ts";
import { BrokerPollError, loadPaperPollSnapshot, type BrokerPollClient } from "./broker.ts";
import {
  blankBrokerPoll,
  classifyHttpStatus,
  classifyThrown,
  effectiveStaleAfterMs,
  MARKET_EVIDENCE_MAX_AGE_MS,
  readPersistedPoll,
  readStaleAfterMs,
  unknownBrokerOrderCount,
  type BrokerPollFailureKind,
  type BrokerPollHealth,
  type BrokerPollState,
  type ReconciliationReport,
} from "./broker-poll.ts";
import { unsignedResearchProposal, verifyInstruction, type TradeInstruction } from "./instruction.ts";
import { OrderJournal } from "./journal.ts";
import { markUnknown, reconcileRecord, type LifecycleRecord, type LookupFacts } from "./lifecycle.ts";
import { acquireWriterLock, releaseWriterLock } from "./lock.ts";
import { MODE_GATE } from "./mode.ts";
import { atomicWrite, directoryFsyncSupported, durabilityLevel, FILE_ONLY_DURABILITY_WARNING, readRequiredJson, type DurabilityLevel } from "./persist.ts";
import { fillsFromExecutions, toResearchOutcome, trustedEvidence, type FillEvent, type FillProvenance, type IncompleteFill } from "./fill-event.ts";
import { assessRisk, flatSnapshot, type MarketSnapshot } from "./risk.ts";

export const POST_ENABLED = false;
export const PAPER_POST_ENABLED = false;
export const LIVE_POST_ENABLED = false;
export const STRATEGY_APPROVED = false;

export interface ExecutorConfig {
  mode: "PAPER" | "LIVE";
  postEnabled: false;
  liveCredentialsLoaded: false;
  statePath: string;
  lockPath: string;
  inboxPath: string;
  journalPath: string;
  hermesPath: string;
  fillsPath: string;
  /** Positive milliseconds. Values above the 5s evidence window are clamped. */
  staleAfterMs?: number;
}

interface DecisionMeta {
  clientOrderId: string;
  decisionId: string;
  strategyVersion: string;
  limitPrice: number;
}

interface Snapshot {
  nonces: string[];
  clientOrderIds: string[];
  records: LifecycleRecord[];
  entriesBlocked?: boolean;
  decisions?: DecisionMeta[];
  fills?: FillEvent[];
  incompleteFills?: IncompleteFill[];
  brokerPoll?: BrokerPollState;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ExecutorConfig {
  const root = env.APEX_EXECUTOR_DATA || "services/apex-executor/data";
  return {
    mode: "PAPER",
    postEnabled: false,
    liveCredentialsLoaded: false,
    statePath: env.APEX_EXECUTOR_STATE || `${root}/state.json`,
    lockPath: env.APEX_EXECUTOR_LOCK || `${root}/writer.lock`,
    inboxPath: env.APEX_EXECUTOR_INBOX || `${root}/inbox.jsonl`,
    journalPath: env.APEX_EXECUTOR_JOURNAL || `${root}/journal.jsonl`,
    hermesPath: env.APEX_EXECUTOR_HERMES || `${root}/hermes.json`,
    fillsPath: env.APEX_EXECUTOR_FILLS || `${root}/fills.jsonl`,
    staleAfterMs: readStaleAfterMs(env),
  };
}

function blankRecord(msg: TradeInstruction): LifecycleRecord {
  return {
    clientOrderId: msg.clientOrderId,
    symbol: msg.symbol,
    side: msg.side,
    qty: msg.qty,
    state: "PROPOSED",
    filledQty: 0,
    linkedExitId: null,
    linkedEntryId: null,
    unknown: false,
    alerted: false,
    submitted: false,
    expiresAt: msg.expiresAt,
  };
}

export class Executor {
  entriesBlocked = false;
  alerts: string[] = [];
  pollFailures = 0;
  ready = false;
  private nonces = new Set<string>();
  private ids = new Set<string>();
  private records = new Map<string, LifecycleRecord>();
  private config: ExecutorConfig;
  private creds: PaperCreds | null;
  private lockFd: number | null = null;
  private journal: OrderJournal;
  private hermes: HermesJournal;
  private market: MarketSnapshot | null = null;
  private marketAt = 0;
  private decisions = new Map<string, DecisionMeta>();
  private fills: FillEvent[] = [];
  private incompleteFills: IncompleteFill[] = [];
  private poll: BrokerPollState = blankBrokerPoll();
  /** Full-success clock for THIS process. Never restored from disk. */
  private processSuccessAt: number | null = null;
  private readonly staleAfterMs: number;
  readonly redact: string[];

  constructor(config: ExecutorConfig, creds: PaperCreds | null) {
    this.config = { ...config, postEnabled: false, liveCredentialsLoaded: false, mode: config.mode === "LIVE" ? "LIVE" : "PAPER" };
    this.staleAfterMs = effectiveStaleAfterMs(config.staleAfterMs ?? readStaleAfterMs({}));
    this.creds = creds;
    this.redact = creds ? [creds.keyId, creds.secret] : [];
    this.journal = new OrderJournal(config.journalPath);
    this.hermes = new HermesJournal(config.hermesPath);
    mkdirSync(dirname(config.fillsPath), { recursive: true });
    try {
      this.lockFd = acquireWriterLock(config.lockPath);
      this.restore();
      this.journal.replay();
    } catch (error) {
      this.release();
      throw error;
    }
  }

  private restore(): void {
    const parsed = readRequiredJson(this.config.statePath);
    if (parsed == null) return;
    const snap = parsed as Snapshot;
    if (!snap || !Array.isArray(snap.nonces) || !Array.isArray(snap.clientOrderIds) || !Array.isArray(snap.records)) {
      throw new Error("executor state corrupt; fail closed");
    }
    if (snap.entriesBlocked != null && typeof snap.entriesBlocked !== "boolean") throw new Error("executor state corrupt; fail closed");
    for (const nonce of snap.nonces) {
      if (typeof nonce !== "string") throw new Error("executor state corrupt; fail closed");
      this.nonces.add(nonce);
    }
    for (const id of snap.clientOrderIds) {
      if (typeof id !== "string") throw new Error("executor state corrupt; fail closed");
      this.ids.add(id);
    }
    for (const rec of snap.records) {
      if (!rec || typeof rec.clientOrderId !== "string" || typeof rec.state !== "string") throw new Error("executor state corrupt; fail closed");
      this.records.set(rec.clientOrderId, { ...rec, linkedEntryId: rec.linkedEntryId ?? null });
    }
    this.entriesBlocked = snap.entriesBlocked === true;
    if (snap.decisions != null && !Array.isArray(snap.decisions)) throw new Error("executor state corrupt; fail closed");
    for (const row of snap.decisions ?? []) {
      if (!row || typeof row.clientOrderId !== "string" || typeof row.decisionId !== "string") throw new Error("executor state corrupt; fail closed");
      this.decisions.set(row.clientOrderId, row);
    }
    if (snap.fills != null && !Array.isArray(snap.fills)) throw new Error("executor state corrupt; fail closed");
    if (snap.incompleteFills != null && !Array.isArray(snap.incompleteFills)) throw new Error("executor state corrupt; fail closed");
    this.fills = snap.fills ?? [];
    this.incompleteFills = snap.incompleteFills ?? [];
    const persisted = readPersistedPoll(snap.brokerPoll);
    this.poll = blankBrokerPoll();
    this.processSuccessAt = null;
    if (persisted) {
      this.poll.lastFailureAt = persisted.lastFailureAt;
      this.poll.lastFailureKind = persisted.lastFailureKind;
      this.poll.consecutiveFailures = persisted.consecutiveFailures;
    }
    this.poll.reconciliation = { outcome: "NOT_RUN", outstandingOrders: this.outstanding().length, unknownOrders: 0 };
    this.ready = false;
  }

  private save(): void {
    const snap: Snapshot = {
      nonces: [...this.nonces],
      clientOrderIds: [...this.ids],
      records: [...this.records.values()],
      entriesBlocked: this.entriesBlocked,
      decisions: [...this.decisions.values()],
      fills: this.fills,
      incompleteFills: this.incompleteFills,
      brokerPoll: this.poll,
    };
    atomicWrite(this.config.statePath, JSON.stringify(snap));
  }

  private audit(kind: "accept" | "reject" | "state" | "recovery", reason: string, rec: LifecycleRecord | null): void {
    this.journal.append({
      kind,
      clientOrderId: rec?.clientOrderId ?? null,
      nonce: null,
      decisionId: null,
      purpose: rec?.side === "sell" ? "EXIT" : rec ? "ENTRY" : null,
      symbol: rec?.symbol === "SPY" ? "SPY" : null,
      side: rec?.side ?? null,
      orderType: "limit",
      qty: rec?.qty ?? null,
      limitPrice: null,
      stopPrice: null,
      expiresAt: rec?.expiresAt ?? null,
      linkedEntryId: rec?.linkedExitId ?? null,
      state: rec?.state ?? null,
      filledQty: rec?.filledQty ?? null,
      avgPrice: null,
      submitCount: rec?.submitted ? 1 : 0,
      reason,
    });
  }

  private report(rec: LifecycleRecord, note: string): void {
    const nowIso = new Date().toISOString();
    if (!this.hermes.get(rec.clientOrderId)) {
      const intent: IntentRecord = {
        clientOrderId: rec.clientOrderId,
        ticket: {
          category: "CONNECTIVITY_TEST",
          symbol: rec.symbol,
          side: rec.side,
          orderType: "limit",
          maxNotional: 25,
          expiry: rec.expiresAt,
          singleUseId: rec.clientOrderId,
          readAuthorized: true,
          orderAuthorized: false,
          confirmed: false,
        },
        createdAt: nowIso,
        status: "PERSISTED",
        filledQty: rec.filledQty,
        avgPrice: null,
        paperState: "PROPOSED",
      };
      this.hermes.persist(intent);
    }
    const status: IntentRecord["status"] = rec.unknown
      ? "UNKNOWN"
      : rec.state === "PARTIAL"
        ? "PARTIAL"
        : rec.state === "FLAT" || rec.state === "CLOSED" || rec.state === "OPEN"
          ? "FILLED"
          : "PERSISTED";
    this.hermes.updateStatus(rec.clientOrderId, status, rec.filledQty, null, `${note}; audience=hermes,pilot; postEnabled=false`);
  }

  health(now = Date.now()): {
    ok: true;
    mode: "PAPER_READ_ONLY";
    paperPost: "DISABLED";
    livePost: "DISABLED";
    autonomousStrategyTrading: "DISABLED";
    strategyApproved: false;
    postEnabled: false;
    unknown: number;
    ready: boolean;
    alerts: number;
    host: "127.0.0.1";
    directoryFsyncSupported: boolean;
    durability: DurabilityLevel;
    durabilityWarning: string | null;
    brokerPoll: BrokerPollHealth;
  } {
    const directoriesSynced = directoryFsyncSupported();
    this.ready = this.computeReady(now);
    return {
      ok: true,
      mode: MODE_GATE.mode,
      paperPost: MODE_GATE.paperPost,
      livePost: MODE_GATE.livePost,
      autonomousStrategyTrading: MODE_GATE.autonomousStrategyTrading,
      strategyApproved: false,
      postEnabled: false,
      unknown: [...this.records.values()].filter((rec) => rec.unknown).length,
      ready: this.ready,
      alerts: this.alerts.length,
      host: "127.0.0.1",
      directoryFsyncSupported: directoriesSynced,
      durability: durabilityLevel(),
      durabilityWarning: directoriesSynced ? null : FILE_ONLY_DURABILITY_WARNING,
      brokerPoll: this.brokerPollView(now),
    };
  }

  /**
   * Test and recovery seam for an already-built snapshot.
   * An empty book is a full success. Outstanding orders are not; the poll
   * must reconcile them before ready can become true.
   */
  observeMarket(snapshot: MarketSnapshot, now = Date.now()): void {
    this.market = snapshot;
    this.marketAt = now;
    this.pollFailures = 0;
    if (this.outstanding().length === 0 && snapshot.evidence.openOrders === 0) {
      this.markFullSuccess(now, { outcome: "OK", outstandingOrders: 0, unknownOrders: 0 });
      return;
    }
    this.ready = this.computeReady(now);
  }

  notePoll(failure: string | null): void {
    if (!failure) {
      this.pollFailures = 0;
      this.ready = this.computeReady(Date.now());
      return;
    }
    this.pollFailures += 1;
    this.ready = this.computeReady(Date.now());
    if (this.pollFailures >= 3 && !this.alerts.includes("prolonged paper read failure")) {
      this.alerts.push("prolonged paper read failure");
    }
  }

  /**
   * GET-only broker poll. A full success requires a snapshot (account, clock,
   * positions, open orders, quote) and a clean outstanding-order reconciliation.
   * Transport failures leave the previous full success in place until it ages
   * out. Reconciliation that is not OK refuses execution immediately.
   * Disk timestamps from a previous process are not freshness.
   */
  async runBrokerPoll(client: BrokerPollClient, now = Date.now()): Promise<{ ok: boolean; failureKind: BrokerPollFailureKind | null }> {
    const iso = new Date(now).toISOString();
    this.poll.lastAttemptAt = iso;
    if (!this.creds) {
      this.recordFailure("auth", now);
      this.save();
      return { ok: false, failureKind: "auth" };
    }
    let loaded: { snapshot: MarketSnapshot; openOrders: unknown[] };
    try {
      loaded = await loadPaperPollSnapshot(this.creds, client, now);
    } catch (error) {
      const kind = error instanceof BrokerPollError ? error.kind : classifyThrown(error);
      this.recordFailure(kind, now);
      this.save();
      return { ok: false, failureKind: kind };
    }
    this.market = loaded.snapshot;
    this.marketAt = now;
    this.poll.lastSnapshotOkAt = iso;
    const reconciled = await this.finishReconciliation(client, loaded.openOrders);
    if (reconciled.failureKind) {
      this.poll.reconciliation = reconciled.reconciliation;
      this.recordFailure(reconciled.failureKind, now);
      this.save();
      return { ok: false, failureKind: reconciled.failureKind };
    }
    this.markFullSuccess(now, reconciled.reconciliation);
    return { ok: true, failureKind: null };
  }

  outstanding(): LifecycleRecord[] {
    return [...this.records.values()].filter((rec) => rec.state !== "FLAT" && rec.state !== "CLOSED");
  }

  async recoverOutstanding(get: (url: string) => Promise<{ status: number; body: unknown }>, provenance: FillProvenance = "mock"): Promise<LifecycleRecord[]> {
    const ids = this.outstanding().map((rec) => rec.clientOrderId);
    const out: LifecycleRecord[] = [];
    for (const id of ids) out.push(await this.reconcile(get, id, provenance));
    return out;
  }

  accept(msg: TradeInstruction, now = Date.now()): { accepted: boolean; reason: string; state: "PROPOSED" | null } {
    const unsigned = unsignedResearchProposal(msg);
    if (unsigned) return this.reject(unsigned);
    if (this.config.mode === "LIVE") return { accepted: false, reason: "LIVE submission disabled", state: null };
    const verified = verifyInstruction(msg, { operator: process.env.APEX_OPERATOR_SECRET ?? null, gate: process.env.APEX_GATE_SECRET ?? null }, now);
    if (verified) return this.reject(verified);
    if (msg.side === "sell") return this.reject("sell requires authorizeExit");
    if (this.nonces.has(msg.nonce) || this.ids.has(msg.clientOrderId)) return this.reject("duplicate or replay");
    if (this.entriesBlocked) return this.reject("kill switch blocks new entries");
    if (!this.creds || assertPaperCreds(this.creds)) return this.reject("PAPER credentials rejected");
    if (!this.market) return this.reject("broker evidence missing");
    if (now - this.marketAt > MARKET_EVIDENCE_MAX_AGE_MS || now < this.marketAt) return this.reject("stale broker evidence");
    const blocked = this.executionBlock(now);
    if (blocked) return this.reject(blocked);
    const risk = assessRisk(msg, this.market, { conflict: false, ownedQty: 0 }, this.entriesBlocked, now);
    if (risk) return this.reject(risk);
    const rec = blankRecord(msg);
    this.decisions.set(msg.clientOrderId, { clientOrderId: msg.clientOrderId, decisionId: msg.decisionId, strategyVersion: msg.strategyVersion, limitPrice: msg.limitPrice });
    this.nonces.add(msg.nonce);
    this.ids.add(msg.clientOrderId);
    this.records.set(msg.clientOrderId, rec);
    this.audit("accept", "VALIDATED/PROPOSED; POST disabled; no order transmitted", rec);
    this.report(rec, "VALIDATED/PROPOSED");
    this.save();
    return { accepted: true, reason: "VALIDATED/PROPOSED; POST disabled; no order transmitted", state: "PROPOSED" };
  }

  /** Does not transmit. POST stays disabled, so this cannot mark SUBMISSION_ATTEMPTED. */
  submit(): { submitted: false; reason: string } {
    return { submitted: false, reason: "PAPER POST DISABLED" };
  }

  ingest(raw: string, now = Date.now()): { accepted: boolean; reason: string; state: "PROPOSED" | null } {
    mkdirSync(dirname(this.config.inboxPath), { recursive: true });
    const fd = openSync(this.config.inboxPath, "a");
    try {
      writeSync(fd, `${raw}\n`);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    let parsed: TradeInstruction;
    try {
      parsed = JSON.parse(raw) as TradeInstruction;
    } catch {
      return this.reject("rejected message");
    }
    return this.accept(parsed, now);
  }

  async reconcile(get: (url: string) => Promise<{ status: number; body: unknown }>, clientOrderId: string, provenance: FillProvenance = "mock"): Promise<LifecycleRecord> {
    const rec = this.records.get(clientOrderId);
    if (!rec) throw new Error("unknown instruction");
    const positionsUrl = assertPaperUrl(`${PAPER_TRADING_ORIGIN}/v2/positions`).toString();
    const ordersUrl = assertPaperUrl(`${PAPER_TRADING_ORIGIN}/v2/orders?status=open`).toString();
    const orderUrl = assertPaperUrl(`${PAPER_TRADING_ORIGIN}/v2/orders:by_client_order_id?client_order_id=${encodeURIComponent(clientOrderId)}`).toString();
    let positions: { status: number; body: unknown };
    let open: { status: number; body: unknown };
    let order: { status: number; body: unknown };
    try {
      [positions, open, order] = await Promise.all([get(positionsUrl), get(ordersUrl), get(orderUrl)]);
    } catch (error) {
      const unknown = { ...rec, state: "UNKNOWN" as const, unknown: true, alerted: true };
      this.store(unknown, redactSecrets(error instanceof Error ? error.message : "broker lookup failed", this.redact));
      return unknown;
    }
    let next = reconcileRecord(rec, {
      orderStatus: order.status,
      orderBody: order.body,
      positionsStatus: positions.status,
      positions: positions.body,
      openStatus: open.status,
      openOrders: open.body,
    } satisfies LookupFacts);
    if (rec.side === "buy" && next.state === "FLAT") next = { ...markUnknown(rec), filledQty: rec.filledQty };
    this.recordFill(rec, order.body, provenance);
    this.store(next, next.unknown ? `unknown broker outcome ${clientOrderId}; not resubmitted` : `reconciled ${next.state}`);
    const status = order.body && typeof order.body === "object" ? String((order.body as { status?: string }).status ?? "") : "";
    if (rec.side === "sell" && next.state === "FLAT" && rec.linkedEntryId) {
      const entry = this.records.get(rec.linkedEntryId);
      if (entry) this.store({ ...entry, state: "FLAT", unknown: false, alerted: false }, `flat confirmed by sell fill ${rec.clientOrderId}`);
    }
    if (rec.side === "sell" && next.state !== "FLAT" && (status === "canceled" || status === "cancelled") && rec.linkedEntryId) {
      const entry = this.records.get(rec.linkedEntryId);
      if (entry && entry.linkedExitId === rec.clientOrderId) {
        const stillOpen: LifecycleRecord["state"] = entry.filledQty + 1e-12 < entry.qty ? "PARTIAL" : "OPEN";
        this.store({ ...entry, linkedExitId: null, state: stillOpen, unknown: false }, "exit canceled; position remains");
      }
    }
    return this.records.get(clientOrderId) ?? next;
  }

  async authorizeExit(
    entryId: string,
    sell: TradeInstruction,
    get: (url: string) => Promise<{ status: number; body: unknown }>,
    now = Date.now(),
  ): Promise<{ ok: boolean; reason: string }> {
    const rec = this.records.get(entryId);
    if (!rec) return { ok: false, reason: "unknown entry" };
    if (rec.linkedExitId) return { ok: false, reason: "duplicate exit" };
    if (sell.side !== "sell" || sell.linkedEntryId !== entryId) return { ok: false, reason: "exit not linked to entry" };
    if (!(rec.filledQty > 0) && rec.state !== "PARTIAL" && rec.state !== "OPEN" && rec.state !== "EXIT_PENDING") {
      return { ok: false, reason: "no owned quantity" };
    }
    const proof = verifyApproval(sell, sell.operatorProof, process.env.APEX_OPERATOR_SECRET ?? null, now);
    if (proof) return { ok: false, reason: proof };
    const gate = verifyInstruction(sell, { operator: process.env.APEX_OPERATOR_SECRET ?? null, gate: process.env.APEX_GATE_SECRET ?? null }, now);
    if (gate) return { ok: false, reason: gate };
    if (!this.market) return { ok: false, reason: "broker evidence missing" };
    if (now - this.marketAt > MARKET_EVIDENCE_MAX_AGE_MS || now < this.marketAt) return { ok: false, reason: "stale broker evidence" };
    const blocked = this.executionBlock(now);
    if (blocked) return { ok: false, reason: blocked };
    let positions: { status: number; body: unknown };
    try {
      positions = await get(assertPaperUrl(`${PAPER_TRADING_ORIGIN}/v2/positions`).toString());
    } catch {
      return { ok: false, reason: "owned quantity unresolved" };
    }
    if (positions.status !== 200 || !Array.isArray(positions.body)) return { ok: false, reason: "owned quantity unresolved" };
    const owned = Number((positions.body as { symbol?: string; qty?: string }[]).find((row) => row.symbol === sell.symbol)?.qty ?? Number.NaN);
    if (!Number.isFinite(owned) || !(owned > 0) || sell.qty > owned + 1e-12) return { ok: false, reason: "sell exceeds broker-owned quantity" };
    const sellRec: LifecycleRecord = {
      ...blankRecord(sell),
      linkedEntryId: entryId,
      state: "PROPOSED",
      submitted: false,
      filledQty: 0,
    };
    const next: LifecycleRecord = { ...rec, state: "EXIT_PENDING", linkedExitId: sell.clientOrderId };
    this.decisions.set(sell.clientOrderId, { clientOrderId: sell.clientOrderId, decisionId: sell.decisionId, strategyVersion: sell.strategyVersion, limitPrice: sell.limitPrice });
    this.nonces.add(sell.nonce);
    this.ids.add(sell.clientOrderId);
    this.records.set(sell.clientOrderId, sellRec);
    this.store(sellRec, "sell recorded; not submitted");
    this.store(next, "exit authorized; POST disabled");
    return { ok: true, reason: "exit authorized; POST disabled" };
  }

  /** Labels an unconfirmed attempt without transmitting. Production submit() never calls this. */
  noteUnconfirmedAttempt(clientOrderId: string): LifecycleRecord {
    if (POST_ENABLED) throw new Error("POST is disabled");
    const rec = this.records.get(clientOrderId);
    if (!rec || rec.state !== "PROPOSED") throw new Error("not a proposal");
    const next: LifecycleRecord = { ...rec, state: "SUBMISSION_ATTEMPTED", submitted: true };
    this.store(next, "SUBMISSION_ATTEMPTED recorded without transmit; POST disabled");
    return next;
  }

  /**
   * Execution stays closed unless this process has a full poll inside
   * staleAfterMs and the latest reconciliation is OK. Snapshot success
   * without reconciliation is not enough. Disk timestamps are not enough.
   */
  private executionBlock(now: number): string | null {
    if (this.poll.reconciliation.outcome !== "OK" && this.poll.reconciliation.outcome !== "NOT_RUN") {
      return "broker reconciliation failed";
    }
    if (!this.pollFresh(now)) return "stale broker evidence";
    return null;
  }

  private pollFresh(now: number): boolean {
    if (this.processSuccessAt == null) return false;
    if (now < this.processSuccessAt) return false;
    return now - this.processSuccessAt <= this.staleAfterMs;
  }

  private computeReady(now: number): boolean {
    if (!this.market) return false;
    if (now < this.marketAt || now - this.marketAt > MARKET_EVIDENCE_MAX_AGE_MS) return false;
    return this.executionBlock(now) == null;
  }

  private brokerPollView(now: number): BrokerPollHealth {
    const fresh = this.processSuccessAt;
    const reconciliation = this.poll.reconciliation.outcome === "NOT_RUN"
      ? { outcome: "NOT_RUN" as const, outstandingOrders: this.outstanding().length, unknownOrders: 0 }
      : this.poll.reconciliation;
    return {
      lastAttemptAt: this.poll.lastAttemptAt,
      lastSnapshotOkAt: this.poll.lastSnapshotOkAt,
      lastReconcileOkAt: this.poll.lastReconcileOkAt,
      lastFullSuccessAt: this.poll.lastFullSuccessAt,
      lastFailureAt: this.poll.lastFailureAt,
      lastFailureKind: this.poll.lastFailureKind,
      consecutiveFailures: this.poll.consecutiveFailures,
      freshnessMs: fresh == null ? null : now - fresh,
      staleAfterMs: this.staleAfterMs,
      stale: fresh == null || now < fresh || now - fresh > this.staleAfterMs,
      reconciliation,
    };
  }

  private markFullSuccess(now: number, reconciliation: ReconciliationReport): void {
    const iso = new Date(now).toISOString();
    this.poll.lastAttemptAt = iso;
    this.poll.lastSnapshotOkAt = iso;
    this.poll.lastReconcileOkAt = iso;
    this.poll.lastFullSuccessAt = iso;
    this.poll.consecutiveFailures = 0;
    this.poll.reconciliation = reconciliation;
    this.processSuccessAt = now;
    this.pollFailures = 0;
    this.ready = this.computeReady(now);
    this.save();
  }

  private recordFailure(kind: BrokerPollFailureKind, now: number): void {
    this.poll.lastFailureAt = new Date(now).toISOString();
    this.poll.lastFailureKind = kind;
    this.poll.consecutiveFailures += 1;
    this.pollFailures += 1;
    if (this.pollFailures >= 3 && !this.alerts.includes("prolonged paper read failure")) {
      this.alerts.push("prolonged paper read failure");
    }
    this.ready = this.computeReady(now);
  }

  private async finishReconciliation(
    client: BrokerPollClient,
    openOrders: unknown[],
  ): Promise<{ failureKind: BrokerPollFailureKind | null; reconciliation: ReconciliationReport }> {
    const before = this.outstanding().map((rec) => ({ ...rec }));
    if (!Array.isArray(openOrders)) {
      return { failureKind: "parse", reconciliation: { outcome: "FAILED", outstandingOrders: before.length, unknownOrders: 0 } };
    }
    const unknownOrders = unknownBrokerOrderCount(openOrders, new Set(this.records.keys()));
    let transport: BrokerPollFailureKind | null = null;
    for (const rec of before) {
      const looked = await this.lookupOutstanding(client, rec.clientOrderId);
      if (typeof looked === "string") {
        transport = looked;
        break;
      }
      await this.reconcile(async (url) => {
        const hit = looked.get(url);
        if (!hit) throw new BrokerPollError("parse");
        return hit;
      }, rec.clientOrderId, "broker");
    }
    const outstandingOrders = this.outstanding().length;
    if (transport) return { failureKind: transport, reconciliation: { outcome: "FAILED", outstandingOrders, unknownOrders } };
    if (unknownOrders > 0) return { failureKind: "reconcile", reconciliation: { outcome: "UNKNOWN_ORDERS", outstandingOrders, unknownOrders } };
    const unresolved = before.filter((rec) => {
      const current = this.records.get(rec.clientOrderId);
      if (!current) return true;
      if (current.state === "FLAT" || current.state === "CLOSED") return false;
      return current.unknown || current.state === "UNKNOWN" || current.state === "PROPOSED" || current.state === "SUBMISSION_ATTEMPTED";
    });
    if (unresolved.length > 0) return { failureKind: "reconcile", reconciliation: { outcome: "MISMATCH", outstandingOrders, unknownOrders: 0 } };
    return { failureKind: null, reconciliation: { outcome: "OK", outstandingOrders, unknownOrders: 0 } };
  }

  private async lookupOutstanding(client: BrokerPollClient, clientOrderId: string): Promise<Map<string, { status: number; body: unknown }> | BrokerPollFailureKind> {
    const positionsUrl = assertPaperUrl(`${PAPER_TRADING_ORIGIN}/v2/positions`).toString();
    const ordersUrl = assertPaperUrl(`${PAPER_TRADING_ORIGIN}/v2/orders?status=open`).toString();
    const orderUrl = assertPaperUrl(`${PAPER_TRADING_ORIGIN}/v2/orders:by_client_order_id?client_order_id=${encodeURIComponent(clientOrderId)}`).toString();
    try {
      const positions = await client.request({ method: "GET", url: positionsUrl });
      const open = await client.request({ method: "GET", url: ordersUrl });
      const order = await client.request({ method: "GET", url: orderUrl });
      for (const response of [positions, open, order]) {
        const kind = classifyHttpStatus(response.status);
        if (kind === "auth") return "auth";
      }
      if (positions.status !== 200 || open.status !== 200) return "http";
      if (order.status !== 200 && order.status !== 404) return "http";
      return new Map<string, { status: number; body: unknown }>([
        [positionsUrl, { status: positions.status, body: positions.body }],
        [ordersUrl, { status: open.status, body: open.body }],
        [orderUrl, { status: order.status, body: order.body }],
      ]);
    } catch (error) {
      if (error instanceof BrokerPollError) return error.kind;
      return classifyThrown(error);
    }
  }

  private reject(reason: string): { accepted: false; reason: string; state: null } {
    this.audit("reject", reason, null);
    return { accepted: false, reason, state: null };
  }

  private store(rec: LifecycleRecord, note: string): void {
    this.records.set(rec.clientOrderId, rec);
    if (rec.unknown) this.alerts.push(note);
    this.audit("state", note, rec);
    this.report(rec, note);
    this.save();
  }

  get(clientOrderId: string): LifecycleRecord | undefined {
    return this.records.get(clientOrderId);
  }

  /** Telemetry for Hermes. Mock rows are never broker-confirmed performance. */
  fillEvents(): FillEvent[] {
    return this.fills.map((event) => ({ ...event }));
  }

  incompleteFillEvents(): IncompleteFill[] {
    return this.incompleteFills.map((event) => ({ ...event }));
  }

  outcomes(): ExecutionOutcome[] {
    return this.fills.map(toResearchOutcome);
  }

  trustedEvidence(): ReturnType<typeof trustedEvidence> {
    return trustedEvidence(this.fills);
  }

  private recordFill(rec: LifecycleRecord, body: unknown, provenance: FillProvenance): void {
    const meta = this.decisions.get(rec.clientOrderId);
    const extracted = fillsFromExecutions({
      decisionId: meta?.decisionId ?? "",
      strategyVersion: meta?.strategyVersion ?? "",
      clientOrderId: rec.clientOrderId,
      symbol: rec.symbol,
      side: rec.side,
      intendedPrice: meta?.limitPrice ?? Number.NaN,
      body,
      provenance,
      source: "PAPER",
      seenFillIds: this.fills.map((event) => event.fillId).filter((id): id is string => Boolean(id)),
    });
    if (!extracted.events.length && !extracted.incomplete.length) return;
    this.fills.push(...extracted.events);
    this.incompleteFills.push(...extracted.incomplete);
    const fd = openSync(this.config.fillsPath, "a");
    try {
      for (const row of [...extracted.events, ...extracted.incomplete]) writeSync(fd, JSON.stringify(row) + "\n");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }

  release(): void {
    if (this.lockFd == null && this.config == null) return;
    const fd = this.lockFd;
    this.lockFd = null;
    try {
      releaseWriterLock(this.config.lockPath, fd);
    } catch {
      /* lock already gone */
    }
  }
}

export function assertNoLiveCreds(env: NodeJS.ProcessEnv): void {
  if (env.APEX_EXECUTOR_MODE === "LIVE" && env.APEX_EXECUTOR_ENABLE_LIVE === "I_ENABLE_LIVE") {
    throw new Error("LIVE submission disabled");
  }
  if (env.APCA_LIVE_API_KEY_ID || env.APCA_LIVE_API_SECRET_KEY || env.APEX_EXECUTOR_LIVE_KEY_ID || env.APEX_EXECUTOR_LIVE_SECRET || env.LIVE_APCA_API_KEY_ID || env.LIVE_APCA_API_SECRET_KEY) {
    throw new Error("LIVE credentials must not be loaded in PAPER mode");
  }
}

export function openMarket(now: number): MarketSnapshot {
  return flatSnapshot(now);
}

export function nextPollDelay(previous: number, failed: boolean): number {
  if (!failed) return 1_000;
  return Math.min(Math.max(previous, 1_000) * 2, 30_000);
}
