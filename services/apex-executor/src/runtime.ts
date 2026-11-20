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
import { SUPERVISED_PAPER_TEST } from "../../../src/lib/apex/live/connectivity.ts";
import { HermesJournal } from "../../../src/lib/apex/live/journal.ts";
import type { IntentRecord } from "../../../src/lib/apex/live/executor.ts";
import type { ExecutionOutcome } from "../../../src/lib/apex/research/hermes-outcomes.ts";
import { verifyActivation, type PaperActivation } from "./activation.ts";
import { verifyApproval } from "./approval.ts";
import { BUDGET_RESERVE, outstandingOrderCap, PER_ORDER_TRADING_GETS, pollTradingCost, RequestBudget, TRADING_API_BUDGET_PER_MIN } from "./budget.ts";
import { BrokerPollError, loadPaperPollSnapshot, type BrokerPollClient } from "./broker.ts";
import { createDisabledPaperWriter, ProcessCrash, type PaperWriter, type WriteResult } from "./broker-write.ts";
import {
  blankBrokerPoll,
  BROKER_POLL_INTERVAL_MS,
  classifyHttpStatus,
  classifyThrown,
  effectiveStaleAfterMs,
  MARKET_EVIDENCE_MAX_AGE_MS,
  POLL_BACKOFF_CAP_MS,
  readPersistedPoll,
  readPollIntervalMs,
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
import { fillsFromExecutions, hermesPerformanceRefusal, toResearchOutcome, trustedEvidence, type FillEvent, type FillProvenance, type IncompleteFill } from "./fill-event.ts";
import { tradingOriginGuard } from "../../../src/lib/apex/broker/allowlist.ts";
import { devSubmitFlag, paperPostEnvOn, submitRefusal, type SubmitFacts } from "./gates.ts";
import { absenceVerdict, fillsHitOrder, readAbsenceAttempts, readAbsenceBackoffMs, readFillPage, readOrderList, type AbsenceProbe } from "./absence.ts";
import { fillsFromActivities, readAlpacaOrder } from "./alpaca-fill.ts";
import { applyCumulativeFill, inFlightOrder, isOrderState, orderStateFromBroker, regressesOrder, transitionRefusal, type OrderState } from "./order-machine.ts";
import { brokerBodyMismatch, exactBrokerBody, limitConversionRefusal, verifySupervisedOrder, type SupervisedOrder } from "./supervised-order.ts";
import { assessRisk, flatSnapshot, readMaxOrderQty, type MarketSnapshot } from "./risk.ts";

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
  /** Baseline delay between polls. Success resets to this. Default 3000. */
  pollIntervalMs?: number;
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
  instructions?: TradeInstruction[];
  supervisedOrders?: SupervisedOrder[];
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
    pollIntervalMs: readPollIntervalMs(env),
  };
}

function writerEvidenceChannel(writer: PaperWriter): "alpaca-http" | "injected" {
  const tagged = writer as PaperWriter & { evidenceChannel?: string };
  if (tagged.evidenceChannel === "injected") return "injected";
  return writer.networkWrite === "alpaca-http" ? "alpaca-http" : "injected";
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
    orderState: "intent",
    nonce: msg.nonce,
    avgPrice: null,
    brokerOrderId: null,
    confirmedAbsent: false,
    notional: msg.sizedNotional,
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
  private instructions = new Map<string, TradeInstruction>();
  private supervisedOrders = new Map<string, SupervisedOrder>();
  private poll: BrokerPollState = blankBrokerPoll();
  private budget = new RequestBudget();
  private recoveryPending = false;
  private startupComplete = true;
  private writesRequireActivation = false;
  private operatorEnv: NodeJS.ProcessEnv = process.env;
  private activation: { startsAt: number; expiresAt: number } | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private exclusiveDepth = 0;
  private activityWriter: PaperWriter | null = null;
  private fillFeePolicy: "require" | "explicit_zero" = "require";
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
      this.absorbJournal();
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
      if (rec.orderState != null && !isOrderState(rec.orderState)) throw new Error("executor state corrupt; fail closed");
      if (rec.confirmedAbsent != null && typeof rec.confirmedAbsent !== "boolean") throw new Error("executor state corrupt; fail closed");
      this.records.set(rec.clientOrderId, { ...rec, linkedEntryId: rec.linkedEntryId ?? null, avgPrice: rec.avgPrice ?? null });
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
    if (snap.instructions != null && !Array.isArray(snap.instructions)) throw new Error("executor state corrupt; fail closed");
    for (const instruction of snap.instructions ?? []) {
      if (!instruction || typeof instruction.clientOrderId !== "string" || typeof instruction.nonce !== "string") throw new Error("executor state corrupt; fail closed");
      this.instructions.set(instruction.clientOrderId, instruction);
    }
    if (snap.supervisedOrders != null && !Array.isArray(snap.supervisedOrders)) throw new Error("executor state corrupt; fail closed");
    for (const order of snap.supervisedOrders ?? []) {
      if (!order || typeof order.clientOrderId !== "string" || typeof order.nonce !== "string" || (order.orderType !== "market_notional" && order.orderType !== "market_qty")) {
        throw new Error("executor state corrupt; fail closed");
      }
      this.supervisedOrders.set(order.clientOrderId, order);
    }
    this.recoveryPending = [...this.records.values()].some((rec) => inFlightOrder(rec));
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
      instructions: [...this.instructions.values()],
      supervisedOrders: [...this.supervisedOrders.values()],
    };
    atomicWrite(this.config.statePath, JSON.stringify(snap));
  }

  private absorbJournal(): void {
    for (const row of this.journal.replay()) {
      if (typeof row.clientOrderId === "string" && row.clientOrderId.length > 0) this.ids.add(row.clientOrderId);
      if (typeof row.nonce === "string" && row.nonce.length > 0) this.nonces.add(row.nonce);
    }
  }

  private audit(kind: "accept" | "reject" | "state" | "kill" | "recovery" | "intent" | "illegal", reason: string, rec: LifecycleRecord | null, nonce: string | null = null): void {
    this.journal.append({
      kind,
      clientOrderId: rec?.clientOrderId ?? null,
      nonce: nonce ?? rec?.nonce ?? null,
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
      orderState: rec?.orderState ?? null,
      filledQty: rec?.filledQty ?? null,
      avgPrice: rec?.avgPrice ?? null,
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
          category: rec.signedOrderType ? SUPERVISED_PAPER_TEST : "CONNECTIVITY_TEST",
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
    const status: IntentRecord["status"] = rec.confirmedAbsent
      ? "CANCELED"
      : rec.unknown || rec.orderState === "UNKNOWN"
        ? "UNKNOWN"
        : rec.orderState === "rejected"
          ? "REJECTED"
          : rec.orderState === "canceled" || rec.orderState === "expired"
            ? "CANCELED"
            : rec.state === "PARTIAL" || rec.orderState === "partially_filled"
              ? "PARTIAL"
              : rec.state === "FLAT" || rec.state === "OPEN" || rec.orderState === "filled"
                ? "FILLED"
                : rec.orderState === "submitted" || rec.orderState === "accepted"
                  ? "SUBMITTED"
                  : "PERSISTED";
    const category = rec.signedOrderType ? "SUPERVISED_PAPER_TEST" : this.instructions.get(rec.clientOrderId)?.category ?? "CONNECTIVITY_TEST";
    this.hermes.updateStatus(rec.clientOrderId, status, rec.filledQty, rec.avgPrice ?? null, `${note}; audience=hermes,pilot; postEnabled=false; category=${category}; strategyApproved=false`);
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
    unknownClientOrderIds: string[];
    ready: boolean;
    alerts: number;
    host: "127.0.0.1";
    directoryFsyncSupported: boolean;
    durability: DurabilityLevel;
    durabilityWarning: string | null;
    brokerPoll: BrokerPollHealth;
    requestBudget: { limitPerMin: number; used: number; reserve: number; outstandingCap: number; inFlight: number };
    supervisedActivation: "closed" | "open";
    activationExpiresAt: string | null;
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
      unknown: this.unknownRecords().length,
      unknownClientOrderIds: this.unknownRecords().map((rec) => rec.clientOrderId),
      ready: this.ready,
      alerts: this.alerts.length,
      host: "127.0.0.1",
      directoryFsyncSupported: directoriesSynced,
      durability: durabilityLevel(),
      durabilityWarning: directoriesSynced ? null : FILE_ONLY_DURABILITY_WARNING,
      brokerPoll: this.brokerPollView(now),
      requestBudget: {
        limitPerMin: TRADING_API_BUDGET_PER_MIN,
        used: this.budget.used(now),
        reserve: BUDGET_RESERVE,
        outstandingCap: this.orderCap(),
        inFlight: this.inFlightCount(),
      },
      supervisedActivation: this.activationOpen(now) ? "open" : "closed",
      activationExpiresAt: this.activation ? new Date(this.activation.expiresAt).toISOString() : null,
    };
  }

  startupIsReady(): boolean {
    return this.startupComplete;
  }

  markStartupPending(): void {
    this.startupComplete = false;
  }

  markStartupReady(): void {
    this.startupComplete = true;
  }

  activationOpen(now = Date.now()): boolean {
    if (!this.activation) return false;
    return now >= this.activation.startsAt && now < this.activation.expiresAt;
  }

  armPaperActivation(window: PaperActivation, env: NodeJS.ProcessEnv, now = Date.now()): { ok: boolean; reason: string } {
    const problem = verifyActivation(window, env, now);
    if (problem) return { ok: false, reason: problem };
    this.activation = { startsAt: Date.parse(window.startsAt), expiresAt: Date.parse(window.expiresAt) };
    return { ok: true, reason: "activation window open" };
  }

  /** One queue for accept, submit, cancel, and the broker poll. Callers already inside it must use the unlocked helpers. */
  runLocked<T>(fn: () => Promise<T>): Promise<T> {
    return this.exclusive(fn);
  }

  serialize<T>(fn: () => Promise<T>): Promise<T> {
    return this.runLocked(fn);
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
  async runBrokerPoll(client: BrokerPollClient, now = Date.now(), queued = false): Promise<{ ok: boolean; failureKind: BrokerPollFailureKind | null }> {
    if (!queued) return this.exclusive(() => this.runBrokerPoll(client, now, true));
    const iso = new Date(now).toISOString();
    this.poll.lastAttemptAt = iso;
    if (!this.creds) {
      this.recordFailure("auth", now);
      this.save();
      return { ok: false, failureKind: "auth" };
    }
    const cost = pollTradingCost(this.outstanding().length);
    if (!this.budget.tryTake(now, cost)) {
      if (!this.alerts.includes("request budget exceeded")) this.alerts.push("request budget exceeded");
      this.ready = this.computeReady(now);
      return { ok: false, failureKind: null };
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
    await this.reconcileDelayedFills(now);
    return { ok: true, failureKind: null };
  }

  requireActivation(): void {
    this.writesRequireActivation = true;
  }

  useEnv(env: NodeJS.ProcessEnv): void {
    this.operatorEnv = env;
  }

  attachActivityWriter(writer: PaperWriter): void {
    this.activityWriter = writer;
  }

  /**
   * Pull FILL activities only while recorded qty is still short of the broker filled qty.
   * A fully attributed order is not queried again. The lookup is a poll, so it cannot spend the reserve.
   */
  async reconcileDelayedFills(now = Date.now()): Promise<void> {
    if (!this.activityWriter) return;
    for (const rec of [...this.records.values()]) {
      if (!this.needsFillActivities(rec)) continue;
      await this.noteActivities(rec, this.activityWriter, now, "poll");
    }
  }

  private attributedQty(rec: LifecycleRecord): number {
    let sum = 0;
    for (const event of this.fills) {
      if (event.clientOrderId === rec.clientOrderId && event.brokerOrderId === rec.brokerOrderId) sum += event.qty;
    }
    return sum;
  }

  private needsFillActivities(rec: LifecycleRecord): boolean {
    if (typeof rec.brokerOrderId !== "string" || rec.brokerOrderId.length === 0) return false;
    if (!(rec.filledQty > 0)) return false;
    return this.attributedQty(rec) + 1e-9 < rec.filledQty;
  }

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(async () => {
      this.exclusiveDepth += 1;
      try {
        return await fn();
      } finally {
        this.exclusiveDepth -= 1;
      }
    });
    this.chain = run.then(() => undefined, () => undefined);
    return run;
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
    if (this.recoveryPending) return this.reject("in-flight orders unresolved");
    if (this.entriesBlocked) return this.reject("kill switch blocks new entries");
    if (!this.creds || assertPaperCreds(this.creds)) return this.reject("PAPER credentials rejected");
    if (!this.market) return this.reject("broker evidence missing");
    if (now - this.marketAt > MARKET_EVIDENCE_MAX_AGE_MS || now < this.marketAt) return this.reject("stale broker evidence");
    const blocked = this.executionBlock(now);
    if (blocked) return this.reject(blocked);
    const risk = assessRisk(msg, this.market, { conflict: false, ownedQty: 0 }, this.entriesBlocked, now, readMaxOrderQty(process.env));
    if (risk) return this.reject(risk);
    const rec = blankRecord(msg);
    this.decisions.set(msg.clientOrderId, { clientOrderId: msg.clientOrderId, decisionId: msg.decisionId, strategyVersion: msg.strategyVersion, limitPrice: msg.limitPrice });
    this.instructions.set(msg.clientOrderId, msg);
    this.nonces.add(msg.nonce);
    this.ids.add(msg.clientOrderId);
    this.records.set(msg.clientOrderId, rec);
    this.audit("accept", "VALIDATED/PROPOSED; POST disabled; no order transmitted", rec, msg.nonce);
    this.audit("intent", "durable intent before any broker write", rec, msg.nonce);
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
      const unknown = { ...rec, state: "UNKNOWN" as const, unknown: true, alerted: true, orderState: rec.submitted || (rec.orderState != null && rec.orderState !== "intent") ? "UNKNOWN" as const : rec.orderState };
      this.store(unknown, redactSecrets(error instanceof Error ? error.message : "broker lookup failed", this.redact));
      return unknown;
    }
    if (this.viewRegresses(rec, order.body)) return rec;
    let next = reconcileRecord(rec, {
      orderStatus: order.status,
      orderBody: order.body,
      positionsStatus: positions.status,
      positions: positions.body,
      openStatus: open.status,
      openOrders: open.body,
    } satisfies LookupFacts);
    if (rec.side === "buy" && next.state === "FLAT") next = { ...markUnknown(rec), filledQty: rec.filledQty, orderState: "UNKNOWN" };
    next = this.withBrokerOrder(rec, next, order.status, order.body);
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
    if (!this.budget.tryTake(now, 1, "exit")) return { ok: false, reason: "request budget exceeded" };
    let positions: { status: number; body: unknown };
    try {
      positions = await get(assertPaperUrl(`${PAPER_TRADING_ORIGIN}/v2/positions`).toString());
    } catch {
      return { ok: false, reason: "owned quantity unresolved" };
    }
    if (positions.status !== 200 || !Array.isArray(positions.body)) return { ok: false, reason: "owned quantity unresolved" };
    const owned = Number((positions.body as { symbol?: string; qty?: string }[]).find((row) => row.symbol === sell.symbol)?.qty ?? Number.NaN);
    const pending = this.pendingSellQty(sell.symbol, sell.clientOrderId);
    if (!Number.isFinite(owned) || !(owned > 0) || sell.qty > owned - pending + 1e-12) return { ok: false, reason: "sell exceeds broker-owned quantity" };
    if (rec.linkedExitId) return { ok: false, reason: "duplicate exit" };
    const sellRec: LifecycleRecord = {
      ...blankRecord(sell),
      linkedEntryId: entryId,
      state: "PROPOSED",
      submitted: false,
      filledQty: 0,
      orderState: "intent",
    };
    this.instructions.set(sell.clientOrderId, sell);
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
    const next: LifecycleRecord = { ...rec, state: "SUBMISSION_ATTEMPTED", submitted: true, orderState: "submitted" };
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
    if (this.inFlightCount() === 0) this.recoveryPending = false;
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
      // An unsent intent is not a broker mismatch on the first poll after start.
      // After this process has a full success, a proposal still unsent at the next poll is a mismatch.
      if (this.processSuccessAt == null && current.submitted !== true && current.state === "PROPOSED" && (current.orderState == null || current.orderState === "intent")) return false;
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
      missingFee: this.fillFeePolicy,
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

  realWriter(): PaperWriter {
    return createDisabledPaperWriter();
  }

  engageKillSwitch(now = Date.now()): void {
    this.entriesBlocked = true;
    this.audit("kill", "kill switch engaged; new entries blocked; authorized exits still require every gate", null);
    void now;
    this.save();
  }

  inFlightCount(): number {
    return [...this.records.values()].filter((rec) => inFlightOrder(rec)).length;
  }

  private orderCap(): number {
    return outstandingOrderCap({ pollIntervalMs: this.config.pollIntervalMs ?? 3_000 });
  }

  private pendingSellQty(symbol: string, exceptId: string): number {
    let sum = 0;
    for (const rec of this.records.values()) {
      if (rec.side !== "sell" || rec.symbol !== symbol || rec.clientOrderId === exceptId) continue;
      if (rec.confirmedAbsent) continue;
      if (rec.orderState === "canceled" || rec.orderState === "rejected" || rec.orderState === "expired" || rec.orderState === "filled") continue;
      if (rec.state === "FLAT" || rec.state === "CLOSED") continue;
      const liveOrder = rec.orderState === "submitted" || rec.orderState === "accepted" || rec.orderState === "partially_filled" || rec.orderState === "UNKNOWN";
      const openIntent = rec.state === "PROPOSED" || rec.state === "SUBMISSION_ATTEMPTED" || rec.state === "UNKNOWN" || rec.state === "EXIT_PENDING";
      if (!liveOrder && !openIntent) continue;
      sum += Math.max(0, rec.qty - rec.filledQty);
    }
    return sum;
  }

  private heldSpy(): boolean {
    if ((this.market?.positionQty.SPY ?? 0) > 0) return true;
    return [...this.records.values()].some((rec) => rec.symbol === "SPY" && rec.side === "buy" && (rec.state === "OPEN" || rec.state === "PARTIAL" || rec.state === "EXIT_PENDING") && !rec.confirmedAbsent);
  }

  private submitFacts(instruction: TradeInstruction, writer: PaperWriter, env: NodeJS.ProcessEnv, now: number, brokerOwnedQty: number | null): SubmitFacts {
    const fresh = this.market != null && this.pollFresh(now) && now >= this.marketAt && now - this.marketAt <= 5_000;
    return {
      env,
      now,
      writerInjected: writer.networkWrite === "injected",
      lockHeld: this.lockFd != null,
      kill: this.entriesBlocked,
      recoveryPending: this.recoveryPending,
      reconciliationOk: this.poll.reconciliation.outcome === "OK",
      fresh,
      marketPresent: this.market != null,
      marketOpen: this.market?.evidence.clockOpen === true,
      clockHttpOk: this.market?.evidence.http.clock === 200,
      unknownOrders: [...this.records.values()].filter((rec) => (rec.unknown || rec.orderState === "UNKNOWN") && !rec.confirmedAbsent).length,
      inFlight: this.inFlightCount(),
      outstandingCap: this.orderCap(),
      budgetOk: this.budget.canTake(now, 1),
      mode: this.config.mode === "LIVE" ? "LIVE" : "PAPER",
      maxQty: readMaxOrderQty(env),
      instruction,
      record: this.records.get(instruction.clientOrderId) ?? null,
      secrets: { operator: env.APEX_OPERATOR_SECRET ?? null, gate: env.APEX_GATE_SECRET ?? null },
      brokerOwnedQty,
      pendingSellQty: this.pendingSellQty(instruction.symbol, instruction.clientOrderId),
      heldSpy: instruction.side === "buy" ? this.heldSpy() : false,
    };
  }

  /** Same window the poll and the supervised submit spend. A full window refuses the next call. */
  spendBudget(now: number, cost: number, purpose: "entry" | "poll" | "exit" | "cancel" | "recovery" = "poll"): boolean {
    return this.budget.tryTake(now, cost, purpose);
  }

  acceptSupervised(order: SupervisedOrder, now: number | (() => number) = Date.now()): { accepted: boolean; reason: string; state: "PROPOSED" | null } {
    const signedFirst = verifySupervisedOrder(order, { operator: this.operatorEnv.APEX_OPERATOR_SECRET ?? process.env.APEX_OPERATOR_SECRET ?? null, gate: this.operatorEnv.APEX_GATE_SECRET ?? process.env.APEX_GATE_SECRET ?? null }, this.clock(now));
    if (signedFirst) return { accepted: false, reason: signedFirst, state: null };
    if (this.nonces.has(order.nonce) || this.ids.has(order.clientOrderId)) return { accepted: false, reason: "duplicate or replay", state: null };
    if (this.writesRequireActivation) {
      const disabled = !paperPostEnvOn(this.operatorEnv) || this.operatorEnv.LIVE_POST_ENABLED === "true";
      if (disabled) return { accepted: false, reason: "PAPER POST DISABLED", state: null };
      const emergency = order.orderType === "market_qty" && this.emergencyExitOpen(order);
      if (!this.activationOpen(this.clock(now)) && !emergency) return { accepted: false, reason: "activation window closed", state: null };
    }
    if (order.orderType === "market_qty") {
      const linked = this.exitLinkage(order);
      if (linked) return { accepted: false, reason: linked, state: null };
    }
    const t = this.clock(now);
    const refusal = this.supervisedGate(order, process.env, t, order.side === "buy" ? "entry" : "exit", false);
    if (refusal) return { accepted: false, reason: refusal, state: null };
    if (order.orderType === "market_qty") {
      const linked = this.exitLinkage(order);
      if (linked) return { accepted: false, reason: linked, state: null };
    }
    const qty = order.orderType === "market_qty" ? Number(order.qty) : 0;
    const rec: LifecycleRecord = {
      clientOrderId: order.clientOrderId,
      symbol: "SPY",
      side: order.side,
      qty,
      state: "PROPOSED",
      filledQty: 0,
      linkedExitId: null,
      linkedEntryId: order.orderType === "market_qty" ? order.linkedEntryId : null,
      unknown: false,
      alerted: false,
      submitted: false,
      expiresAt: order.expiresAt,
      orderState: "intent",
      nonce: order.nonce,
      avgPrice: null,
      brokerOrderId: null,
      confirmedAbsent: false,
      notional: order.orderType === "market_notional" ? Number(order.notional) : null,
      signedOrderType: order.orderType,
      signedNotional: order.orderType === "market_notional" ? order.notional : null,
      signedQty: order.orderType === "market_qty" ? order.qty : null,
    };
    this.supervisedOrders.set(order.clientOrderId, order);
    this.nonces.add(order.nonce);
    this.ids.add(order.clientOrderId);
    this.records.set(order.clientOrderId, rec);
    if (order.orderType === "market_qty") {
      const entry = this.records.get(order.linkedEntryId);
      if (entry) this.records.set(entry.clientOrderId, { ...entry, state: "EXIT_PENDING", linkedExitId: order.clientOrderId });
    }
    this.audit("accept", "supervised intent; no order transmitted", rec, order.nonce);
    this.audit("intent", "durable intent before any broker write", rec, order.nonce);
    this.save();
    return { accepted: true, reason: "intent journaled", state: "PROPOSED" };
  }

  performanceRefusal(event: FillEvent): string | null {
    return hermesPerformanceRefusal(event);
  }

  private unknownRecords(): LifecycleRecord[] {
    return [...this.records.values()].filter((rec) => (rec.unknown || rec.orderState === "UNKNOWN") && !rec.confirmedAbsent);
  }

  private freshAt(t: number): boolean {
    return this.market != null && this.pollFresh(t) && t >= this.marketAt && t - this.marketAt <= 5_000;
  }

  /** Open position or partial fill. An emergency exit still needs a fresh signed ticket. */
  private emergencyExitOpen(order: SupervisedOrder): boolean {
    if (order.orderType !== "market_qty") return false;
    const entry = this.records.get(order.linkedEntryId);
    if (!entry || entry.symbol !== order.symbol) return false;
    return entry.filledQty > 0 || entry.orderState === "filled" || entry.orderState === "partially_filled" || entry.state === "OPEN" || entry.state === "PARTIAL";
  }

  private viewRegresses(rec: LifecycleRecord, body: unknown): boolean {
    if (!body || typeof body !== "object" || !rec.orderState) return false;
    const row = body as { status?: unknown; filled_qty?: unknown };
    const observed = Number(row.filled_qty);
    const status = typeof row.status === "string" ? row.status : "";
    const mapped = status ? orderStateFromBroker(status, Number.isFinite(observed) ? observed : 0) : null;
    return mapped != null && regressesOrder(rec.orderState, mapped);
  }

  /** Signature, gate, freshness, activation, and risk. Used again immediately before POST. */
  private transmissionBlock(order: SupervisedOrder, env: NodeJS.ProcessEnv, purpose: "entry" | "exit", t: number): string | null {
    if (env.LIVE_POST_ENABLED === "true" || env.APEX_EXECUTOR_ENABLE_LIVE === "I_ENABLE_LIVE") return "LIVE POST DISABLED";
    if (!paperPostEnvOn(env)) return "PAPER POST DISABLED";
    if (this.writesRequireActivation && purpose === "entry" && !this.activationOpen(t)) return "activation window closed";
    if (this.writesRequireActivation && purpose === "exit" && !this.activationOpen(t) && !this.emergencyExitOpen(order)) return "activation window closed";
    const signed = verifySupervisedOrder(order, { operator: env.APEX_OPERATOR_SECRET ?? process.env.APEX_OPERATOR_SECRET ?? null, gate: env.APEX_GATE_SECRET ?? process.env.APEX_GATE_SECRET ?? null }, t);
    if (signed) return signed;
    if (!this.freshAt(t)) return "stale broker evidence";
    if (this.poll.reconciliation.outcome !== "OK") return "broker reconciliation failed";
    if (purpose === "entry" && this.entriesBlocked) return "kill switch blocks new entries";
    if (!this.budget.canTake(t, 1, purpose)) return "request budget exceeded";
    return null;
  }

  /** Intent was durable but nothing was sent. Leave a terminal expired order instead of UNKNOWN. */
  private untransmitted(rec: LifecycleRecord, reason: string): LifecycleRecord {
    const from = rec.orderState ?? "intent";
    if (from !== "intent" && from !== "submitted") return rec;
    if (transitionRefusal(from, "expired")) return rec;
    const next: LifecycleRecord = { ...rec, state: "CLOSED", orderState: "expired", submitted: false, unknown: false, alerted: false };
    this.store(next, `untransmitted; ${reason}`);
    return next;
  }

  private clock(now: number | (() => number)): number {
    return typeof now === "function" ? now() : now;
  }

  private finishUnsent(order: SupervisedOrder, reason: string): { submitted: false; reason: string; orderState: OrderState | null } {
    const rec = this.records.get(order.clientOrderId);
    const unsent = rec && !rec.unknown && (rec.orderState === "intent" || rec.orderState === "submitted");
    const terminalize = unsent && (this.writesRequireActivation || rec.orderState === "submitted");
    if (terminalize && rec) {
      const next = this.untransmitted(rec, reason);
      return { submitted: false, reason, orderState: next.orderState ?? null };
    }
    return this.refuseSupervised(order, reason);
  }

  private refuseSupervised(order: SupervisedOrder, reason: string): { submitted: false; reason: string; orderState: OrderState | null } {
    this.audit("reject", reason, this.records.get(order.clientOrderId) ?? null, order.nonce);
    return { submitted: false, reason, orderState: this.records.get(order.clientOrderId)?.orderState ?? null };
  }

  private supervisedGate(order: SupervisedOrder, env: NodeJS.ProcessEnv, t: number, purpose: "entry" | "exit", requirePost: boolean): string | null {
    if (requirePost) {
      if (devSubmitFlag(env) && !paperPostEnvOn(env)) return "dev flag cannot authorize submission";
      if (!paperPostEnvOn(env)) return "PAPER POST DISABLED";
      if (env.LIVE_POST_ENABLED === "true" || env.APEX_EXECUTOR_ENABLE_LIVE === "I_ENABLE_LIVE") return "LIVE POST DISABLED";
      if (tradingOriginGuard(env.APCA_API_BASE_URL).blockOrders) return "LIVE URL refused";
    }
    const signed = verifySupervisedOrder(order, { operator: env.APEX_OPERATOR_SECRET ?? process.env.APEX_OPERATOR_SECRET ?? null, gate: env.APEX_GATE_SECRET ?? process.env.APEX_GATE_SECRET ?? null }, t);
    if (signed) return signed;
    if (this.lockFd == null) return "writer lock not held";
    if (this.recoveryPending) return "in-flight orders unresolved";
    if (this.unknownRecords().length > 0) return "UNKNOWN orders block new submits";
    if (!this.market) return "broker evidence missing";
    if (!this.freshAt(t)) return "stale broker evidence";
    if (this.poll.reconciliation.outcome !== "OK") return "broker reconciliation failed";
    if (this.market.evidence.clockOpen !== true || this.market.evidence.http.clock !== 200) return "market closed";
    if (purpose === "entry" && this.entriesBlocked) return "kill switch blocks new entries";
    if (purpose === "entry" && this.heldSpy()) return "per-symbol position limit";
    const maxQty = readMaxOrderQty(env);
    if (maxQty == null) return "max qty unavailable";
    if (order.orderType === "market_qty" && Number(order.qty) > maxQty) return "quantity exceeds max";
    if (purpose === "entry" && this.inFlightCount() >= this.orderCap()) return "outstanding order cap";
    if (!this.budget.canTake(t, 1, purpose)) return "request budget exceeded";
    return null;
  }

  private exitLinkage(order: Extract<SupervisedOrder, { orderType: "market_qty" }>): string | null {
    const entry = this.records.get(order.linkedEntryId);
    if (!entry || entry.side !== "buy") return "exit not linked to a journaled entry";
    if (entry.symbol !== order.symbol) return "exit symbol does not match the entry";
    if (!(entry.filledQty > 0) && entry.state !== "OPEN" && entry.state !== "PARTIAL" && entry.orderState !== "filled") return "exit not linked to a filled entry";
    const journaled = this.journal.replay().some((row) => row.clientOrderId === entry.clientOrderId && (row.orderState === "filled" || row.state === "OPEN" || row.state === "PARTIAL" || row.state === "EXIT_PENDING"));
    if (!journaled) return "exit not linked to a journaled entry";
    return null;
  }

  private sellRoom(order: Extract<SupervisedOrder, { orderType: "market_qty" }>, owned: number): string | null {
    const linked = this.exitLinkage(order);
    if (linked) return linked;
    if (!(owned > 0)) return "sell exceeds broker-owned quantity";
    if (Number(order.qty) > owned - this.pendingSellQty(order.symbol, order.clientOrderId) + 1e-12) return "sell exceeds broker-owned quantity";
    return null;
  }

  private async readOwned(writer: PaperWriter, symbol: string, t: number): Promise<number | string> {
    if (writer.networkWrite === "alpaca-http") {
      if (!this.budget.canTake(t, 1, "exit")) return "request budget exceeded";
    } else if (!this.budget.tryTake(t, 1, "exit")) return "request budget exceeded";
    try {
      const positions = await writer.getPositions(writer.networkWrite === "alpaca-http" ? "exit" : undefined);
      if (positions.status !== 200 || !Array.isArray(positions.body)) return "owned quantity unresolved";
      const row = (positions.body as { symbol?: string; qty?: string }[]).find((item) => item.symbol === symbol);
      const qty = row ? Number(row.qty) : 0;
      if (!Number.isFinite(qty)) return "owned quantity unresolved";
      return qty;
    } catch (error) {
      if (error instanceof ProcessCrash) throw error;
      return "owned quantity unresolved";
    }
  }

  async submitPaper(instruction: SupervisedOrder | TradeInstruction, writer: PaperWriter, env: NodeJS.ProcessEnv = process.env, now: number | (() => number) = Date.now(), queued = false): Promise<{ submitted: boolean; reason: string; orderState: OrderState | null }> {
    if (!queued) return this.exclusive(() => this.submitPaper(instruction, writer, env, now, true));
    const converted = limitConversionRefusal(instruction);
    if (converted) return { submitted: false, reason: converted, orderState: null };
    if (writer.networkWrite !== "injected" && writer.networkWrite !== "alpaca-http") return { submitted: false, reason: "REAL_BROKER_WRITE_DISABLED", orderState: null };
    const order = instruction as SupervisedOrder;
    if (writer.networkWrite === "alpaca-http" && !this.startupComplete) return this.refuseSupervised(order, "startup recovery incomplete");
    const purpose = order.side === "buy" ? "entry" as const : "exit" as const;
    const early = this.supervisedGate(order, env, this.clock(now), purpose, true);
    if (early) return this.finishUnsent(order, early);
    if (order.side === "sell") {
      const owned = await this.readOwned(writer, order.symbol, this.clock(now));
      if (typeof owned === "string") return this.finishUnsent(order, owned);
      const afterRead = this.supervisedGate(order, env, this.clock(now), "exit", true);
      if (afterRead) return this.finishUnsent(order, afterRead);
      const afterAwait = writer.networkWrite === "alpaca-http" ? this.transmissionBlock(order, env, "exit", this.clock(now)) : null;
      if (afterAwait) return this.finishUnsent(order, afterAwait);
      const room = this.sellRoom(order, owned);
      if (room) return this.finishUnsent(order, room);
    }
    const rec = this.records.get(order.clientOrderId);
    if (!rec || rec.orderState !== "intent") return { submitted: false, reason: "duplicate submit", orderState: rec?.orderState ?? null };
    const body = exactBrokerBody(order);
    const mismatch = brokerBodyMismatch(order, body);
    if (mismatch) return this.finishUnsent(order, mismatch);
    const stored = this.supervisedOrders.get(order.clientOrderId);
    if (!stored || brokerBodyMismatch(stored, body) || stored.nonce !== order.nonce) return this.finishUnsent(order, "instruction does not match the durable intent");
    const t = this.clock(now);
    if (!this.freshAt(t)) return this.finishUnsent(order, "stale broker evidence");
    if (Date.parse(order.expiresAt) <= t) return this.finishUnsent(order, "instruction expired");
    if (writer.networkWrite === "alpaca-http") {
      if (!this.budget.canTake(t, 1, purpose)) return this.finishUnsent(order, "request budget exceeded");
    } else if (!this.budget.tryTake(t, 1, purpose)) return this.finishUnsent(order, "request budget exceeded");
    const immediate = this.clock(now);
    const beforeJournal = writer.networkWrite === "alpaca-http" ? this.transmissionBlock(order, env, purpose, immediate) : (!this.freshAt(immediate) ? "stale broker evidence" : Date.parse(order.expiresAt) <= immediate ? "instruction expired" : null);
    if (beforeJournal) return this.finishUnsent(order, beforeJournal);
    const problem = transitionRefusal("intent", "submitted");
    if (problem) return this.refuseSupervised(order, problem);
    const submitted: LifecycleRecord = { ...rec, state: "SUBMISSION_ATTEMPTED", submitted: true, orderState: "submitted" };
    this.store(submitted, "submitted; durable intent fsynced before broker write");
    const finalBody = exactBrokerBody(stored);
    const beforePost = writer.networkWrite === "alpaca-http" ? this.transmissionBlock(order, env, purpose, this.clock(now)) : null;
    if (beforePost) return this.finishUnsent(order, beforePost);
    if (brokerBodyMismatch(stored, finalBody)) return this.finishUnsent(order, "broker body does not match the signed order");
    let result: WriteResult;
    try {
      result = await writer.submit(finalBody);
    } catch (error) {
      if (error instanceof ProcessCrash) throw error;
      const unknown = this.becomeUnknown(submitted, "submit interrupted; not retried");
      return { submitted: false, reason: "submit interrupted; not retried", orderState: unknown.orderState ?? "UNKNOWN" };
    }
    return this.applyWriteResult(submitted, result, writer, this.clock(now));
  }

  async cancelPaper(clientOrderId: string, writer: PaperWriter, env: NodeJS.ProcessEnv = process.env, now = Date.now(), queued = false): Promise<{ canceled: boolean; reason: string; orderState: OrderState | null }> {
    if (!queued) return this.runLocked(() => this.cancelPaper(clientOrderId, writer, env, now, true));
    if (writer.networkWrite !== "injected" && writer.networkWrite !== "alpaca-http") return { canceled: false, reason: "REAL_BROKER_WRITE_DISABLED", orderState: null };
    if (!paperPostEnvOn(env)) return { canceled: false, reason: "PAPER POST DISABLED", orderState: null };
    const rec = this.records.get(clientOrderId);
    if (!rec) return { canceled: false, reason: "unknown instruction", orderState: null };
    if (this.lockFd == null) return { canceled: false, reason: "writer lock not held", orderState: rec.orderState ?? null };
    if (!this.pollFresh(now) || !this.market || now - this.marketAt > 5_000) return { canceled: false, reason: "stale broker evidence", orderState: rec.orderState ?? null };
    if (this.poll.reconciliation.outcome !== "OK") return { canceled: false, reason: "broker reconciliation failed", orderState: rec.orderState ?? null };
    const from = rec.orderState;
    if (from !== "accepted" && from !== "partially_filled") return { canceled: false, reason: "cancel refused", orderState: from ?? null };
    if (writer.networkWrite === "alpaca-http") {
      if (!this.budget.canTake(now, 2, "cancel")) return { canceled: false, reason: "request budget exceeded", orderState: from };
    } else if (!this.budget.tryTake(now, 1, "cancel")) return { canceled: false, reason: "request budget exceeded", orderState: from };
    let result: WriteResult;
    try {
      result = await writer.cancel(clientOrderId);
    } catch (error) {
      if (error instanceof ProcessCrash) throw error;
      const unknown = this.becomeUnknown(rec, "cancel interrupted; not retried");
      return { canceled: false, reason: "cancel interrupted; not retried", orderState: unknown.orderState ?? "UNKNOWN" };
    }
    if (result.kind === "ack") {
      const applied = await this.applyAck(rec, result, writer, now);
      return { canceled: applied.orderState === "canceled" || applied.orderState === "expired", reason: applied.orderState === "canceled" ? "canceled" : `broker status ${applied.orderState ?? "unknown"}`, orderState: applied.orderState ?? null };
    }
    const unknown = this.becomeUnknown(rec, "cancel unresolved; not retried");
    return { canceled: false, reason: "cancel unresolved; not retried", orderState: unknown.orderState ?? "UNKNOWN" };
  }

  /**
   * GET by client_order_id before any retry. A 404 on an order that was sent
   * is confirmed absence: this id is not posted again. A found order is adopted.
   */
  async recoverInFlight(writer: PaperWriter, now: number | (() => number) = Date.now(), sleep: (ms: number) => Promise<void> = async () => {}): Promise<{ resolved: boolean; reason: string }> {
    if (writer.networkWrite !== "injected" && writer.networkWrite !== "alpaca-http") return { resolved: false, reason: "REAL_BROKER_WRITE_DISABLED" };
    const ids = [...this.records.values()].filter((rec) => inFlightOrder(rec) || ((rec.unknown || rec.orderState === "UNKNOWN") && !rec.confirmedAbsent)).map((rec) => rec.clientOrderId);
    if (ids.length === 0) {
      this.recoveryPending = false;
      this.save();
      return { resolved: true, reason: "no in-flight orders" };
    }
    let reason = "recovered without resubmit";
    for (const id of ids) {
      const verdict = await this.absenceWindow(writer, id, now, sleep);
      if (verdict === "unknown") reason = "absence window ended without sufficient evidence";
      if (verdict === "absent") reason = "confirmed absent; not resubmitted";
    }
    this.recoveryPending = this.inFlightCount() > 0 || this.unknownRecords().length > 0;
    this.save();
    return { resolved: this.unknownRecords().length === 0 && !this.recoveryPending, reason };
  }

  private async absenceWindow(writer: PaperWriter, id: string, now: number | (() => number), sleep: (ms: number) => Promise<void>): Promise<"present" | "absent" | "unknown"> {
    const attempts = readAbsenceAttempts(process.env);
    const backoff = readAbsenceBackoffMs(process.env);
    const probes: AbsenceProbe[] = [];
    const rounds = Number.isFinite(attempts) ? attempts : 0;
    for (let i = 0; i < rounds; i += 1) {
      const t = this.clock(now);
      if (writer.networkWrite !== "alpaca-http" && !this.budget.tryTake(t, 4, "recovery")) {
        const rec = this.records.get(id);
        if (rec) this.becomeUnknown(rec, "recovery budget exhausted; absence not confirmed");
        return "unknown";
      }
      const probe = await this.absenceProbe(writer, id);
      probes.push(probe);
      if (probe.byClientStatus === 200 && probe.foundBody) {
        const view = readAlpacaOrder(probe.foundBody);
        if (view && view.clientOrderId === id) {
          const rec = this.records.get(id);
          if (rec) this.adoptFound(rec, probe.foundBody);
          return "present";
        }
      }
      const verdict = absenceVerdict(probes, attempts);
      if (verdict === "present") return "present";
      if (verdict === "absent") {
        const rec = this.records.get(id);
        if (rec) this.confirmAbsent(rec);
        return "absent";
      }
      if (i + 1 < rounds && Number.isFinite(backoff)) await sleep(backoff);
    }
    const rec = this.records.get(id);
    if (rec) this.becomeUnknown(rec, "absence window ended without sufficient evidence");
    return "unknown";
  }

  private async absenceProbe(writer: PaperWriter, id: string): Promise<AbsenceProbe & { foundBody?: unknown }> {
    const blank = (status: AbsenceProbe["byClientStatus"]): AbsenceProbe => ({
      byClientStatus: status, openStatus: "error", allStatus: "error", fillsStatus: "error",
      openHit: false, allHit: false, openTruncated: false, allTruncated: false, fillsTruncated: false, fillHit: false,
    });
    try {
      const by = await writer.getOrder(id);
      const open = await writer.listOrders("open");
      const all = await writer.listOrders("all");
      const fills = await writer.listFills();
      const brokerId = this.records.get(id)?.brokerOrderId ?? null;
      const byView = by.status === 200 ? readAlpacaOrder(by.body) : null;
      const openPage = open.status === 200 ? readOrderList(open.body) : null;
      const allPage = all.status === 200 ? readOrderList(all.body) : null;
      const fillPage = fills.status === 200 ? readFillPage(fills.body) : null;
      return {
        byClientStatus: by.status === 200 && !byView ? "error" : by.status,
        openStatus: open.status === 200 && openPage && !openPage.malformed ? 200 : "error",
        allStatus: all.status === 200 && allPage && !allPage.malformed ? 200 : "error",
        fillsStatus: fills.status === 200 && fillPage && !fillPage.malformed ? 200 : "error",
        openHit: openPage?.list ? openPage.list.some((row) => !!row && typeof row === "object" && (row as { client_order_id?: unknown }).client_order_id === id) : false,
        allHit: allPage?.list ? allPage.list.some((row) => !!row && typeof row === "object" && (row as { client_order_id?: unknown }).client_order_id === id) : false,
        openTruncated: openPage?.truncated === true,
        allTruncated: allPage?.truncated === true,
        fillsTruncated: fillPage?.truncated === true,
        fillHit: fillsHitOrder(fills.body, brokerId),
        foundBody: byView ? by.body : undefined,
      };
    } catch {
      return blank("error");
    }
  }

  private adoptFound(rec: LifecycleRecord, body: unknown): LifecycleRecord {
    const view = readAlpacaOrder(body);
    if (!view || view.clientOrderId !== rec.clientOrderId) return this.becomeUnknown(rec, "broker order id mismatch; not resubmitted");
    const mapped = orderStateFromBroker(view.status, view.filledQty);
    const from = rec.orderState ?? "UNKNOWN";
    if (!mapped || transitionRefusal(from, mapped)) return this.becomeUnknown(rec, "broker order found but the transition is illegal; not resubmitted");
    const next: LifecycleRecord = {
      ...rec,
      orderState: mapped,
      brokerOrderId: view.id,
      filledQty: Math.max(rec.filledQty, view.filledQty),
      avgPrice: view.filledAvgPrice ?? rec.avgPrice ?? null,
      unknown: false,
      alerted: false,
      submitted: true,
      state: mapped === "filled" && rec.side === "buy" ? "OPEN" : mapped === "accepted" ? "SUBMISSION_ATTEMPTED" : rec.state,
    };
    this.store(next, "broker order found by client_order_id; not resubmitted");
    return next;
  }

  /** Broker GET only. Used to fold a later partial or full fill into the journal. */
  async syncPaper(clientOrderId: string, writer: PaperWriter, now = Date.now()): Promise<{ ok: boolean; reason: string; orderState: OrderState | null }> {
    if (writer.networkWrite !== "injected" && writer.networkWrite !== "alpaca-http") return { ok: false, reason: "REAL_BROKER_WRITE_DISABLED", orderState: null };
    const looked = await this.readBroker(writer, clientOrderId, now);
    if (!looked.ok) return { ok: false, reason: looked.reason, orderState: this.records.get(clientOrderId)?.orderState ?? null };
    const next = await this.applyLookup(clientOrderId, looked, now);
    if (next) await this.noteActivities(next, writer, now);
    return { ok: true, reason: "synced", orderState: next?.orderState ?? null };
  }

  private async readBroker(writer: PaperWriter, clientOrderId: string, now: number): Promise<{ ok: true; order: { status: number; body: unknown }; positions: { status: number; body: unknown }; open: { status: number; body: unknown } } | { ok: false; reason: string }> {
    if (writer.networkWrite === "alpaca-http") {
      if (!this.budget.canTake(now, PER_ORDER_TRADING_GETS, "recovery")) return { ok: false, reason: "request budget exceeded" };
    } else if (!this.budget.tryTake(now, PER_ORDER_TRADING_GETS, "recovery")) return { ok: false, reason: "request budget exceeded" };
    try {
      const positions = await writer.getPositions();
      const open = await writer.getOpenOrders();
      const order = await writer.getOrder(clientOrderId);
      for (const response of [positions, open, order]) {
        if (response.status === 429) return { ok: false, reason: "broker rate limited; not retried" };
        if (response.status >= 500) return { ok: false, reason: "broker unavailable; not retried" };
      }
      if (positions.status !== 200 || open.status !== 200) return { ok: false, reason: "broker lookup failed" };
      if (order.status !== 200 && order.status !== 404) return { ok: false, reason: "broker lookup failed" };
      return { ok: true, order, positions, open };
    } catch (error) {
      if (error instanceof ProcessCrash) throw error;
      return { ok: false, reason: "broker lookup failed" };
    }
  }

  private async applyLookup(clientOrderId: string, looked: { order: { status: number; body: unknown }; positions: { status: number; body: unknown }; open: { status: number; body: unknown } }, now: number): Promise<LifecycleRecord | null> {
    const rec = this.records.get(clientOrderId);
    if (!rec) return null;
    void now;
    if (looked.order.status === 404) {
      if (rec.submitted || rec.orderState === "submitted" || rec.orderState === "UNKNOWN" || rec.state === "SUBMISSION_ATTEMPTED") {
        return this.becomeUnknown(rec, "single 404 is not confirmed absence");
      }
      return rec;
    }
    this.fillFeePolicy = "require";
    try {
      return await this.reconcile(async (url) => {
        if (url.includes("by_client_order_id")) return looked.order;
        if (url.includes("/v2/positions")) return looked.positions;
        if (url.includes("/v2/orders")) return looked.open;
        throw new Error("unexpected lookup url");
      }, clientOrderId, "broker");
    } finally {
      this.fillFeePolicy = "require";
    }
  }

  private async applyWriteResult(rec: LifecycleRecord, result: WriteResult, writer: PaperWriter, now: number): Promise<{ submitted: boolean; reason: string; orderState: OrderState | null }> {
    if (result.kind === "rejected") {
      const problem = transitionRefusal(rec.orderState ?? "submitted", "rejected");
      if (problem) {
        const unknown = this.becomeUnknown(rec, problem);
        return { submitted: false, reason: problem, orderState: unknown.orderState ?? "UNKNOWN" };
      }
      const next: LifecycleRecord = { ...rec, state: "CLOSED", orderState: "rejected", unknown: false, alerted: false };
      this.store(next, "broker rejected; not resubmitted");
      return { submitted: false, reason: "broker rejected", orderState: "rejected" };
    }
    if (result.kind !== "ack") {
      const reason = result.kind === "ambiguous" ? "ambiguous submit; not retried" : result.kind === "rate_limit" ? "broker rate limited; not retried" : "broker unavailable; not retried";
      const unknown = this.becomeUnknown(rec, reason);
      return { submitted: false, reason, orderState: unknown.orderState ?? "UNKNOWN" };
    }
    const next = await this.applyAck(rec, result, writer, now);
    const accepted = next.orderState === "accepted" || next.orderState === "partially_filled" || next.orderState === "filled" || next.orderState === "canceled" || next.orderState === "expired";
    return { submitted: accepted, reason: accepted ? `broker ${next.orderState}` : "broker outcome unresolved", orderState: next.orderState ?? null };
  }

  private async applyAck(rec: LifecycleRecord, result: { kind: "ack"; status: number; body: Record<string, unknown> }, writer: PaperWriter, now: number): Promise<LifecycleRecord> {
    if (writer.networkWrite === "alpaca-http") {
      if (!this.budget.canTake(now, 2, "recovery")) return this.becomeUnknown(rec, "request budget exceeded");
    } else {
      if (!this.budget.canTake(now, 2, "recovery")) return this.becomeUnknown(rec, "request budget exceeded");
      this.budget.tryTake(now, 2, "recovery");
    }
    let positions: { status: number; body: unknown };
    let open: { status: number; body: unknown };
    try {
      positions = await writer.getPositions();
      open = await writer.getOpenOrders();
    } catch (error) {
      if (error instanceof ProcessCrash) throw error;
      return this.becomeUnknown(rec, "ack lookup failed; not retried");
    }
    this.fillFeePolicy = "require";
    let stored: LifecycleRecord;
    try {
      stored = await this.reconcile(async (url) => {
        if (url.includes("by_client_order_id")) return { status: result.status, body: result.body };
        if (url.includes("/v2/positions")) return positions;
        if (url.includes("/v2/orders")) return open;
        throw new Error("unexpected lookup url");
      }, rec.clientOrderId, "broker");
    } finally {
      this.fillFeePolicy = "require";
    }
    const finished = this.preferExplicitTerminal(stored, result.body, positions.body, open.body);
    await this.noteActivities(finished, writer, now);
    return this.records.get(finished.clientOrderId) ?? finished;
  }

  private async noteActivities(rec: LifecycleRecord, writer: PaperWriter, now: number, purpose: "poll" | "recovery" = "recovery"): Promise<void> {
    if (typeof rec.brokerOrderId !== "string" || rec.brokerOrderId.length === 0) return;
    if (writer.networkWrite === "alpaca-http") {
      if (!this.budget.canTake(now, 1, purpose)) return;
    } else if (!this.budget.tryTake(now, 1, purpose)) return;
    let activities: unknown = [];
    try {
      const listed = await writer.listFills(purpose);
      if (listed.status !== 200 || !Array.isArray(listed.body)) return;
      activities = listed.body;
    } catch (error) {
      if (error instanceof ProcessCrash) throw error;
      return;
    }
    const order = this.supervisedOrders.get(rec.clientOrderId);
    const extracted = fillsFromActivities({
      decisionId: order?.decisionId ?? rec.clientOrderId,
      strategyVersion: order?.strategyVersion ?? "v1",
      clientOrderId: rec.clientOrderId,
      brokerOrderId: rec.brokerOrderId,
      symbol: rec.symbol,
      side: rec.side,
      intendedPrice: rec.avgPrice != null && rec.avgPrice > 0 ? rec.avgPrice : 1,
      activities,
      evidenceChannel: writerEvidenceChannel(writer),
      seenFillIds: this.fills.map((event) => event.fillId).filter((id): id is string => Boolean(id)),
    });
    if (!extracted.events.length) return;
    this.fills.push(...extracted.events);
    const feeNote = extracted.events.map((event) => `fillId=${event.fillId}; orderId=${event.brokerOrderId}; qty=${event.qty}; price=${event.fillPrice}; at=${event.at}; provenance=${event.provenance}; feeKnown=${event.feeKnown === true}; netPnlAttributable=${event.netPnlAttributable === true}`).join(" | ");
    this.report(rec, `operational fill; ${feeNote}`);
    const fd = openSync(this.config.fillsPath, "a");
    try {
      for (const row of extracted.events) writeSync(fd, JSON.stringify(row) + "\n");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    this.save();
  }

  /**
   * A broker cancel/expire/reject of an unfilled order is that terminal state
   * when the position book and the open-order book do not show it. An empty
   * book alone never becomes FLAT for a buy.
   */
  private preferExplicitTerminal(rec: LifecycleRecord, body: Record<string, unknown>, positions: unknown, open: unknown): LifecycleRecord {
    const status = typeof body.status === "string" ? body.status : "";
    const filled = Number(body.filled_qty ?? 0);
    const mapped = orderStateFromBroker(status, Number.isFinite(filled) ? filled : 0);
    if (mapped !== "canceled" && mapped !== "expired" && mapped !== "rejected") return rec;
    if (filled > 0 || !Array.isArray(positions) || !Array.isArray(open)) return rec;
    const owned = Number((positions as { symbol?: string; qty?: string }[]).find((row) => row.symbol === rec.symbol)?.qty ?? 0);
    if (owned > 0) return rec;
    const stillOpen = (open as { client_order_id?: string }[]).some((row) => row.client_order_id === rec.clientOrderId);
    if (stillOpen) return rec;
    const from = rec.orderState ?? "submitted";
    if (transitionRefusal(from, mapped)) return rec;
    const next: LifecycleRecord = { ...rec, orderState: mapped, state: "CLOSED", unknown: false, alerted: false, confirmedAbsent: false };
    this.store(next, `broker ${mapped}; not resubmitted`);
    return next;
  }

  private confirmAbsent(rec: LifecycleRecord): LifecycleRecord {
    const from = rec.orderState ?? "UNKNOWN";
    const problem = transitionRefusal(from, "canceled");
    if (problem) {
      this.audit("illegal", problem, rec, rec.nonce ?? null);
      return this.becomeUnknown(rec, `${problem}; not resubmitted`);
    }
    const next: LifecycleRecord = { ...rec, state: "CLOSED", orderState: "canceled", unknown: false, alerted: false, confirmedAbsent: true };
    this.store(next, "confirmed absent; not resubmitted");
    return next;
  }

  private becomeUnknown(rec: LifecycleRecord, reason: string): LifecycleRecord {
    const from = rec.orderState;
    if (from && from !== "UNKNOWN") {
      const problem = transitionRefusal(from, "UNKNOWN");
      if (problem) {
        this.audit("illegal", problem, rec, rec.nonce ?? null);
        const stuck: LifecycleRecord = { ...rec, unknown: true, alerted: true, state: "UNKNOWN" };
        this.store(stuck, `${problem}; ${reason}`);
        return stuck;
      }
    }
    const next: LifecycleRecord = { ...markUnknown(rec), orderState: "UNKNOWN" };
    this.store(next, reason);
    return next;
  }

  private withBrokerOrder(prev: LifecycleRecord, next: LifecycleRecord, orderStatus: number, body: unknown): LifecycleRecord {
    const row = body && typeof body === "object" ? body as { status?: unknown; filled_qty?: unknown; filled_avg_price?: unknown; id?: unknown } : null;
    const status = row && typeof row.status === "string" ? row.status : "";
    const observed = row ? Number(row.filled_qty) : Number.NaN;
    if (next.unknown && orderStatus === 200 && status) {
      const mapped = orderStateFromBroker(status, Number.isFinite(observed) ? observed : 0);
      const from = prev.orderState ?? "submitted";
      if (mapped === "accepted" && !(observed > 0) && prev.submitted && !transitionRefusal(from, "accepted")) {
        return { ...next, state: "SUBMISSION_ATTEMPTED", unknown: false, alerted: false, orderState: "accepted", brokerOrderId: typeof row?.id === "string" ? row.id : null };
      }
    }
    if (next.unknown) {
      const sent = prev.submitted || (prev.orderState != null && prev.orderState !== "intent");
      return sent ? { ...next, orderState: "UNKNOWN" } : next;
    }
    if (!prev.submitted && (prev.orderState == null || prev.orderState === "intent")) return next;
    if (orderStatus !== 200 || !row) return next;
    const from = prev.orderState ?? "submitted";
    if (status) {
      const mapped = orderStateFromBroker(status, Number.isFinite(observed) ? observed : 0);
      if (!mapped) return { ...markUnknown(next), orderState: "UNKNOWN" };
      const problem = transitionRefusal(from, mapped);
      if (problem) {
        this.audit("illegal", problem, next, prev.nonce ?? null);
        return { ...markUnknown(next), orderState: "UNKNOWN" };
      }
      next = { ...next, orderState: mapped, state: mapped === "partially_filled" ? "PARTIAL" : next.state, unknown: false, alerted: false };
    }
    const brokerId = typeof row.id === "string" ? row.id : next.brokerOrderId ?? null;
    const avgRaw = Number(row.filled_avg_price);
    if (Number.isFinite(observed) && observed >= 0 && Number.isFinite(avgRaw) && avgRaw > 0) {
      const applied = applyCumulativeFill(prev.filledQty, prev.avgPrice ?? null, Math.max(prev.filledQty, observed), avgRaw);
      if (!applied.ok) {
        this.audit("illegal", applied.reason, next, prev.nonce ?? null);
        return { ...markUnknown(next), orderState: "UNKNOWN" };
      }
      next = { ...next, avgPrice: applied.avg };
    }
    return { ...next, brokerOrderId: brokerId };
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

export function nextPollDelay(previous: number, failed: boolean, baseline = BROKER_POLL_INTERVAL_MS): number {
  if (!Number.isSafeInteger(baseline) || baseline <= 0) throw new Error("poll interval must be a positive integer");
  if (!failed) return baseline;
  const cap = Math.max(POLL_BACKOFF_CAP_MS, baseline);
  return Math.min(Math.max(previous, baseline) * 2, cap);
}

export interface PollTimer {
  setTimer(delayMs: number, fire: () => Promise<void> | void): unknown;
  clearTimer(handle: unknown): void;
}

/**
 * Immediate first poll, then wait the delay chosen by nextPollDelay.
 * `poll` returns true on failure, false on success, and null to keep the current delay.
 */
export class PollScheduler {
  private delay: number;
  private handle: unknown = null;
  private stopped = false;
  private readonly baseline: number;
  private readonly poll: () => Promise<boolean | null>;
  private readonly timer: PollTimer;

  constructor(baseline: number, poll: () => Promise<boolean | null>, timer: PollTimer) {
    this.baseline = baseline;
    this.poll = poll;
    this.timer = timer;
    this.delay = baseline;
  }

  async start(): Promise<void> {
    await this.tick();
  }

  stop(): void {
    this.stopped = true;
    if (this.handle != null) {
      this.timer.clearTimer(this.handle);
      this.handle = null;
    }
  }

  private async tick(): Promise<void> {
    if (this.stopped) return;
    let outcome: boolean | null = true;
    try {
      outcome = await this.poll();
    } catch {
      outcome = true;
    }
    if (this.stopped) return;
    if (outcome !== null) this.delay = nextPollDelay(this.delay, outcome, this.baseline);
    this.handle = this.timer.setTimer(this.delay, () => this.tick());
  }
}
