/**
 * Apex Executor runtime.
 * PAPER read-only. POST hard-disabled. Durable replay state.
 * Fills come from PAPER GET reconciliation, not caller events.
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync, openSync, closeSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { PAPER_TRADING_ORIGIN, DATA_ORIGIN, assertPaperUrl } from "../../../src/lib/apex/broker/allowlist.ts";
import { assertPaperCreds, type PaperCreds } from "../../../src/lib/apex/broker/paper-read.ts";
import { validateShape, verifyOperatorProof, type TradeInstruction } from "./instruction.ts";
import { markUnknown, onObservedFill, reconcileToBroker, type LifecycleRecord } from "./lifecycle.ts";

export const POST_ENABLED = false;
export const STRATEGY_APPROVED = false;

export interface ExecutorConfig {
  mode: "PAPER" | "LIVE";
  postEnabled: false;
  liveCredentialsLoaded: false;
  statePath: string;
  lockPath: string;
}

interface Snapshot {
  nonces: string[];
  clientOrderIds: string[];
  records: LifecycleRecord[];
  owner: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ExecutorConfig {
  const mode = env.APEX_EXECUTOR_MODE === "LIVE" ? "LIVE" : "PAPER";
  return {
    mode,
    postEnabled: false,
    liveCredentialsLoaded: false,
    statePath: env.APEX_EXECUTOR_STATE || "services/apex-executor/data/state.json",
    lockPath: env.APEX_EXECUTOR_LOCK || "services/apex-executor/data/writer.lock",
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
  private owner: string;

  constructor(config: ExecutorConfig, creds: PaperCreds | null, owner = "executor-1") {
    this.config = config;
    this.creds = creds;
    this.owner = owner;
    this.acquireLock();
    this.restore();
  }

  private acquireLock(): void {
    mkdirSync(dirname(this.config.lockPath), { recursive: true });
    if (existsSync(this.config.lockPath)) {
      const held = readFileSync(this.config.lockPath, "utf8");
      if (held && held !== this.owner) throw new Error("one active writer already holds this account");
    }
    writeFileSync(this.config.lockPath, this.owner);
  }

  private restore(): void {
    if (!existsSync(this.config.statePath)) return;
    const snap = JSON.parse(readFileSync(this.config.statePath, "utf8")) as Snapshot;
    for (const n of snap.nonces) this.nonces.add(n);
    for (const id of snap.clientOrderIds) this.ids.add(id);
    for (const rec of snap.records) this.records.set(rec.clientOrderId, rec);
  }

  private save(): void {
    mkdirSync(dirname(this.config.statePath), { recursive: true });
    const snap: Snapshot = {
      nonces: [...this.nonces],
      clientOrderIds: [...this.ids],
      records: [...this.records.values()],
      owner: this.owner,
    };
    const tmp = `${this.config.statePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(snap));
    writeFileSync(this.config.statePath, readFileSync(tmp));
  }

  health(): { ok: true; mode: string; postEnabled: false; writer: string; unknown: number } {
    return { ok: true, mode: this.config.mode, postEnabled: false, writer: this.owner, unknown: [...this.records.values()].filter((r) => r.unknown).length };
  }

  accept(msg: TradeInstruction, now = Date.now()): { accepted: boolean; reason: string } {
    const shape = validateShape(msg);
    if (shape) return { accepted: false, reason: shape };
    const proof = verifyOperatorProof(msg, process.env.APEX_OPERATOR_SECRET ?? null, now);
    if (proof) return { accepted: false, reason: proof };
    if (this.nonces.has(msg.nonce) || this.ids.has(msg.clientOrderId)) return { accepted: false, reason: "duplicate or replay" };
    if (this.entriesBlocked && msg.side === "buy") return { accepted: false, reason: "kill switch blocks new entries" };
    if (this.config.mode === "LIVE" || this.config.liveCredentialsLoaded) return { accepted: false, reason: "LIVE submission disabled" };
    if (!this.creds || assertPaperCreds(this.creds)) return { accepted: false, reason: "PAPER credentials rejected" };
    this.nonces.add(msg.nonce);
    this.ids.add(msg.clientOrderId);
    this.records.set(msg.clientOrderId, { clientOrderId: msg.clientOrderId, state: "ENTRY_PENDING", filledQty: 0, linkedExitId: null, unknown: false, alerted: false });
    this.save();
    return { accepted: true, reason: "validated; POST disabled; no order submitted" };
  }

  async reconcile(get: (url: string) => Promise<{ status: number; body: unknown }>, clientOrderId: string): Promise<LifecycleRecord> {
    const rec = this.records.get(clientOrderId);
    if (!rec) throw new Error("unknown instruction");
    const credErr = this.creds ? assertPaperCreds(this.creds) : "missing creds";
    if (credErr) throw new Error(credErr);
    const positionsUrl = assertPaperUrl(`${PAPER_TRADING_ORIGIN}/v2/positions`).toString();
    const ordersUrl = assertPaperUrl(`${PAPER_TRADING_ORIGIN}/v2/orders?status=open`).toString();
    const orderUrl = assertPaperUrl(`${PAPER_TRADING_ORIGIN}/v2/orders:by_client_order_id?client_order_id=${clientOrderId}`).toString();
    void DATA_ORIGIN;
    const [positions, open, order] = await Promise.all([get(positionsUrl), get(ordersUrl), get(orderUrl)]);
    if (positions.status !== 200 || open.status !== 200 || !Array.isArray(positions.body) || !Array.isArray(open.body)) {
      const unknown = markUnknown(rec);
      this.records.set(clientOrderId, unknown);
      this.alerts.push(`unknown broker outcome ${clientOrderId}`);
      this.save();
      return unknown;
    }
    const owned = (positions.body as { symbol?: string; qty?: string }[]).find((p) => p.symbol === "SPY");
    const ownedQty = owned ? Number(owned.qty) : 0;
    const observed = order.status === 200 ? Number((order.body as { filled_qty?: string })?.filled_qty ?? 0) : 0;
    const withFill = onObservedFill(rec, Number.isFinite(observed) ? observed : rec.filledQty);
    const next = reconcileToBroker(withFill, ownedQty, open.body.length);
    if (next.unknown) this.alerts.push(`unknown broker outcome ${clientOrderId}`);
    this.records.set(clientOrderId, next);
    this.save();
    return next;
  }

  authorizeExit(entryId: string, exit: TradeInstruction, ownedQty: number): { ok: boolean; reason: string } {
    const rec = this.records.get(entryId);
    if (!rec) return { ok: false, reason: "unknown entry" };
    if (!exit.exitAuthorizationId || exit.side !== "sell") return { ok: false, reason: "separate sell authorization required" };
    if (!(ownedQty > 0) || exit.qty > ownedQty) return { ok: false, reason: "sell exceeds owned quantity" };
    this.records.set(entryId, { ...rec, state: "EXIT_PENDING", linkedExitId: exit.clientOrderId });
    this.save();
    return { ok: true, reason: "exit authorized; POST disabled" };
  }

  release(): void {
    if (existsSync(this.config.lockPath) && readFileSync(this.config.lockPath, "utf8") === this.owner) unlinkSync(this.config.lockPath);
    void openSync;
    void closeSync;
  }
}

export function assertNoLiveCreds(env: NodeJS.ProcessEnv): void {
  if (env.APEX_EXECUTOR_MODE !== "LIVE" && (env.APCA_LIVE_API_KEY_ID || env.APCA_LIVE_API_SECRET_KEY)) {
    throw new Error("LIVE credentials must not be loaded in PAPER mode");
  }
}
