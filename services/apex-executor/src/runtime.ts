/**
 * Apex Executor runtime.
 * PAPER read-only is the startup default. POST is hard-disabled.
 * Activation cannot be a single environment variable.
 */

import { readFileSync, existsSync, appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { PAPER_TRADING_ORIGIN, LIVE_TRADING_ORIGIN } from "../../../src/lib/apex/broker/allowlist.ts";
import { assertPaperCreds, type PaperCreds } from "../../../src/lib/apex/broker/paper-read.ts";
import { validateInstruction, type TradeInstruction } from "./instruction.ts";
import { applyBrokerStatus, transitionPosition, type LifecycleRecord } from "./lifecycle.ts";

export const POST_ENABLED = false;
export const STRATEGY_APPROVED = false;

export interface ExecutorConfig {
  mode: "PAPER" | "LIVE";
  postEnabled: false;
  liveCredentialsLoaded: false;
  journalPath: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ExecutorConfig {
  const mode = env.APEX_EXECUTOR_MODE === "LIVE" ? "LIVE" : "PAPER";
  return {
    mode,
    postEnabled: false,
    liveCredentialsLoaded: false,
    journalPath: env.APEX_EXECUTOR_JOURNAL || "services/apex-executor/data/journal.jsonl",
  };
}

export function activationAllowed(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.APEX_EXECUTOR_POST === "true" && !existsSync(env.APEX_EXECUTOR_ARM_FILE || "")) {
    return "POST requested without arm file; refused";
  }
  if (!existsSync(env.APEX_EXECUTOR_ARM_FILE || "") || env.APEX_EXECUTOR_ARM_CONFIRM !== "I_AUTHORIZE_ONE_TICKET") {
    return "activation requires arm file and exact confirm phrase";
  }
  return "activation gates present, but POST remains hard-disabled this sprint";
}

export class Executor {
  private seen = new Set<string>();
  private records = new Map<string, LifecycleRecord>();
  entriesBlocked = false;
  private config: ExecutorConfig;
  private creds: PaperCreds | null;

  constructor(config: ExecutorConfig, creds: PaperCreds | null) {
    this.config = config;
    this.creds = creds;
  }

  health(): { ok: true; mode: string; postEnabled: false; liveCredentialsLoaded: false } {
    return { ok: true, mode: this.config.mode, postEnabled: false, liveCredentialsLoaded: false };
  }

  accept(msg: TradeInstruction, now = Date.now()): { accepted: boolean; reason: string } {
    const err = validateInstruction(msg, now);
    if (err) return { accepted: false, reason: err };
    if (this.seen.has(msg.nonce) || this.seen.has(msg.clientOrderId)) return { accepted: false, reason: "duplicate or replay" };
    if (this.entriesBlocked && msg.side === "buy") return { accepted: false, reason: "kill switch blocks new entries" };
    if (this.config.mode === "LIVE") return { accepted: false, reason: "LIVE submission disabled" };
    if (this.creds && assertPaperCreds(this.creds)) return { accepted: false, reason: "PAPER credentials rejected" };
    this.seen.add(msg.nonce);
    this.seen.add(msg.clientOrderId);
    this.records.set(msg.clientOrderId, { clientOrderId: msg.clientOrderId, state: "ENTRY_PENDING", filledQty: 0, linkedExitId: null, unknown: false });
    this.journal({ event: "ACCEPTED", clientOrderId: msg.clientOrderId, state: "ENTRY_PENDING" });
    return { accepted: true, reason: "validated; POST disabled; no order submitted" };
  }

  onBroker(clientOrderId: string, status: string, filledQty: number): LifecycleRecord {
    const rec = this.records.get(clientOrderId);
    if (!rec) throw new Error("unknown instruction");
    const next = applyBrokerStatus(rec, status, filledQty);
    this.records.set(clientOrderId, next);
    this.journal({ event: "BROKER", clientOrderId, status, state: next.state, unknown: next.unknown });
    return next;
  }

  authorizeExit(entryId: string, exitId: string): LifecycleRecord {
    const rec = this.records.get(entryId);
    if (!rec || rec.filledQty <= 0) throw new Error("no owned quantity");
    const next = { ...rec, state: transitionPosition(rec.state === "PARTIAL" || rec.state === "OPEN" ? rec.state : "OPEN", "EXIT_PENDING"), linkedExitId: exitId };
    this.records.set(entryId, next);
    this.journal({ event: "EXIT_AUTHORIZED", entryId, exitId });
    return next;
  }

  private journal(row: unknown): void {
    mkdirSync(dirname(this.config.journalPath), { recursive: true });
    appendFileSync(this.config.journalPath, JSON.stringify(row) + "\n");
  }
}

export function assertNoLiveCreds(env: NodeJS.ProcessEnv): void {
  if (env.APEX_EXECUTOR_MODE !== "LIVE" && (env.APCA_LIVE_API_KEY_ID || env.APCA_LIVE_API_SECRET_KEY)) {
    throw new Error("LIVE credentials must not be loaded in PAPER mode");
  }
  void PAPER_TRADING_ORIGIN;
  void LIVE_TRADING_ORIGIN;
}
