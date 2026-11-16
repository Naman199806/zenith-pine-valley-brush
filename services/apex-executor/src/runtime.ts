/**
 * Apex Executor runtime.
 * PAPER read-only. POST hard-disabled.
 * Exclusive writer lock. Crash-safe state. Broker truth is authoritative.
 */

import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { dirname } from "node:path";
import { PAPER_TRADING_ORIGIN, assertPaperUrl } from "../../../src/lib/apex/broker/allowlist.ts";
import { assertPaperCreds, type PaperCreds } from "../../../src/lib/apex/broker/paper-read.ts";
import { verifyApproval, type CanonicalApproval } from "./approval.ts";
import { markUnknown, onObservedFill, reconcileToBroker, type LifecycleRecord } from "./lifecycle.ts";

export const POST_ENABLED = false;

export interface ExecutorConfig {
  mode: "PAPER" | "LIVE";
  postEnabled: false;
  liveCredentialsLoaded: false;
  statePath: string;
  lockPath: string;
  inboxPath: string;
}

interface Snapshot {
  nonces: string[];
  clientOrderIds: string[];
  records: LifecycleRecord[];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ExecutorConfig {
  return {
    mode: env.APEX_EXECUTOR_MODE === "LIVE" ? "LIVE" : "PAPER",
    postEnabled: false,
    liveCredentialsLoaded: false,
    statePath: env.APEX_EXECUTOR_STATE || "services/apex-executor/data/state.json",
    lockPath: env.APEX_EXECUTOR_LOCK || "services/apex-executor/data/writer.lock",
    inboxPath: env.APEX_EXECUTOR_INBOX || "services/apex-executor/data/inbox.jsonl",
  };
}

export class Executor {
  entriesBlocked = false;
  alerts: string[] = [];
  private nonces = new Set<string>();
  private ids = new Set<string>();
  private records = new Map<string, LifecycleRecord>();
  private config: ExecutorConfig;
  private creds: PaperCreds | null;
  private lockFd: number | null = null;

  constructor(config: ExecutorConfig, creds: PaperCreds | null) {
    this.config = config;
    this.creds = creds;
    this.acquireLock();
    this.restore();
  }

  private acquireLock(): void {
    mkdirSync(dirname(this.config.lockPath), { recursive: true });
    try {
      this.lockFd = openSync(this.config.lockPath, "wx");
      writeSync(this.lockFd, String(process.pid));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      throw new Error("one active writer already holds this account");
    }
  }

  recoverStaleLock(): void {
    if (!existsSync(this.config.lockPath)) return;
    unlinkSync(this.config.lockPath);
  }

  private restore(): void {
    if (!existsSync(this.config.statePath)) return;
    let snap: Snapshot;
    try {
      snap = JSON.parse(readFileSync(this.config.statePath, "utf8"));
      if (!Array.isArray(snap.nonces) || !Array.isArray(snap.clientOrderIds) || !Array.isArray(snap.records)) throw new Error("shape");
    } catch {
      throw new Error("executor state corrupt; fail closed");
    }
    for (const n of snap.nonces) this.nonces.add(n);
    for (const id of snap.clientOrderIds) this.ids.add(id);
    for (const rec of snap.records) this.records.set(rec.clientOrderId, rec);
  }

  private save(): void {
    mkdirSync(dirname(this.config.statePath), { recursive: true });
    const snap: Snapshot = { nonces: [...this.nonces], clientOrderIds: [...this.ids], records: [...this.records.values()] };
    const tmp = `${this.config.statePath}.tmp`;
    const fd = openSync(tmp, "w");
    writeSync(fd, JSON.stringify(snap));
    fsyncSync(fd);
    closeSync(fd);
    renameSync(tmp, this.config.statePath);
  }

  health(): { ok: true; mode: string; postEnabled: false; unknown: number } {
    return { ok: true, mode: this.config.mode, postEnabled: false, unknown: [...this.records.values()].filter((r) => r.unknown).length };
  }

  accept(msg: CanonicalApproval & { operatorProof: string | null }, now = Date.now()): { accepted: boolean; reason: string; state: "PROPOSED" | null } {
    const proof = verifyApproval(msg, msg.operatorProof, process.env.APEX_OPERATOR_SECRET ?? null, now);
    if (proof) return { accepted: false, reason: proof, state: null };
    if (!(msg.qty > 0) || !(msg.limitPrice > 0) || (msg.side === "buy" && msg.qty * msg.limitPrice * 1.001 > 25)) return { accepted: false, reason: "quantity or cap invalid", state: null };
    if (this.nonces.has(msg.nonce) || this.ids.has(msg.clientOrderId)) return { accepted: false, reason: "duplicate or replay", state: null };
    if (this.entriesBlocked && msg.side === "buy") return { accepted: false, reason: "kill switch blocks new entries", state: null };
    if (this.config.mode === "LIVE") return { accepted: false, reason: "LIVE submission disabled", state: null };
    if (!this.creds || assertPaperCreds(this.creds)) return { accepted: false, reason: "PAPER credentials rejected", state: null };
    this.nonces.add(msg.nonce);
    this.ids.add(msg.clientOrderId);
    this.records.set(msg.clientOrderId, { clientOrderId: msg.clientOrderId, state: "PROPOSED", filledQty: 0, linkedExitId: null, unknown: false, alerted: false });
    this.save();
    return { accepted: true, reason: "VALIDATED/PROPOSED; POST disabled; no order transmitted", state: "PROPOSED" };
  }

  async reconcile(get: (url: string) => Promise<{ status: number; body: unknown }>, clientOrderId: string): Promise<LifecycleRecord> {
    const rec = this.records.get(clientOrderId);
    if (!rec) throw new Error("unknown instruction");
    const positionsUrl = assertPaperUrl(`${PAPER_TRADING_ORIGIN}/v2/positions`).toString();
    const ordersUrl = assertPaperUrl(`${PAPER_TRADING_ORIGIN}/v2/orders?status=open`).toString();
    const orderUrl = assertPaperUrl(`${PAPER_TRADING_ORIGIN}/v2/orders:by_client_order_id?client_order_id=${encodeURIComponent(clientOrderId)}`).toString();
    const [positions, open, order] = await Promise.all([get(positionsUrl), get(ordersUrl), get(orderUrl)]);
    const orderOk = order.status === 200 && order.body && typeof order.body === "object" && "filled_qty" in (order.body as object);
    if (!orderOk || positions.status !== 200 || open.status !== 200 || !Array.isArray(positions.body) || !Array.isArray(open.body)) {
      const unknown = markUnknown(rec);
      this.records.set(clientOrderId, unknown);
      this.alerts.push(`unknown broker outcome ${clientOrderId}`);
      this.save();
      return unknown;
    }
    const owned = (positions.body as { symbol?: string; qty?: string }[]).find((p) => p.symbol === "SPY");
    const ownedQty = owned ? Number(owned.qty) : 0;
    const observed = Number((order.body as { filled_qty?: string }).filled_qty);
    const next = reconcileToBroker(onObservedFill(rec, observed), ownedQty, open.body.length);
    if (next.state === "FLAT" && (ownedQty !== 0 || open.body.length !== 0 || observed > 0)) {
      const unknown = markUnknown(rec);
      this.records.set(clientOrderId, unknown);
      this.save();
      return unknown;
    }
    if (next.unknown) this.alerts.push(`unknown broker outcome ${clientOrderId}`);
    this.records.set(clientOrderId, next);
    this.save();
    return next;
  }

  async authorizeExit(entryId: string, sell: CanonicalApproval & { operatorProof: string | null }, get: (url: string) => Promise<{ status: number; body: unknown }>, now = Date.now()): Promise<{ ok: boolean; reason: string }> {
    const rec = this.records.get(entryId);
    if (!rec) return { ok: false, reason: "unknown entry" };
    if (rec.linkedExitId) return { ok: false, reason: "duplicate exit" };
    if (sell.side !== "sell" || sell.linkedEntryId !== entryId) return { ok: false, reason: "exit not linked to entry" };
    const proof = verifyApproval(sell, sell.operatorProof, process.env.APEX_OPERATOR_SECRET ?? null, now);
    if (proof) return { ok: false, reason: proof };
    const positions = await get(assertPaperUrl(`${PAPER_TRADING_ORIGIN}/v2/positions`).toString());
    if (positions.status !== 200 || !Array.isArray(positions.body)) return { ok: false, reason: "owned quantity unresolved" };
    const owned = Number((positions.body as { symbol?: string; qty?: string }[]).find((p) => p.symbol === sell.symbol)?.qty ?? 0);
    if (!(owned > 0) || sell.qty > owned) return { ok: false, reason: "sell exceeds broker-owned quantity" };
    this.records.set(entryId, { ...rec, state: "EXIT_PENDING", linkedExitId: sell.clientOrderId });
    this.save();
    return { ok: true, reason: "exit authorized; POST disabled" };
  }

  enqueue(raw: string): void {
    mkdirSync(dirname(this.config.inboxPath), { recursive: true });
    writeFileSync(this.config.inboxPath, `${raw}\n`, { flag: "a" });
  }

  release(): void {
    if (this.lockFd != null) closeSync(this.lockFd);
    if (existsSync(this.config.lockPath)) unlinkSync(this.config.lockPath);
    this.lockFd = null;
  }
}

export function assertNoLiveCreds(env: NodeJS.ProcessEnv): void {
  if (env.APEX_EXECUTOR_MODE !== "LIVE" && (env.APCA_LIVE_API_KEY_ID || env.APCA_LIVE_API_SECRET_KEY)) {
    throw new Error("LIVE credentials must not be loaded in PAPER mode");
  }
}
