/**
 * Append-only order journal. Each line is fsync'd before the call returns.
 * A torn final line from a crash is ignored. A corrupt earlier line fails closed.
 */

import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, writeSync } from "node:fs";
import { dirname } from "node:path";
import type { LifecycleState } from "./lifecycle.ts";

export interface JournalRecord {
  seq: number;
  at: string;
  kind: "accept" | "reject" | "state" | "kill" | "recovery";
  clientOrderId: string | null;
  nonce: string | null;
  decisionId: string | null;
  purpose: "ENTRY" | "EXIT" | "STOP" | null;
  symbol: "SPY" | null;
  side: "buy" | "sell" | null;
  orderType: "limit" | "stop" | "stop_limit" | null;
  qty: number | null;
  limitPrice: number | null;
  stopPrice: number | null;
  expiresAt: string | null;
  linkedEntryId: string | null;
  state: LifecycleState | null;
  filledQty: number | null;
  avgPrice: number | null;
  submitCount: number | null;
  reason: string;
}

export function readJournal(path: string): JournalRecord[] {
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, "utf8");
  if (raw.length === 0) return [];
  const end = raw.endsWith("\n") ? raw.length : raw.lastIndexOf("\n") + 1;
  if (end <= 0) return [];
  const lines = raw.slice(0, end).split("\n").filter((line) => line.length > 0);
  return lines.map((line, index) => {
    try {
      const row = JSON.parse(line) as JournalRecord;
      if (!row || typeof row.seq !== "number" || typeof row.kind !== "string") throw new Error("shape");
      return row;
    } catch {
      throw new Error(`journal corrupt at line ${index + 1}; fail closed`);
    }
  });
}

export class OrderJournal {
  private seq: number;
  readonly path: string;

  constructor(path: string) {
    this.path = path;
    mkdirSync(dirname(path), { recursive: true });
    const existing = readJournal(path);
    this.seq = existing.reduce((max, row) => Math.max(max, row.seq), 0);
  }

  replay(): JournalRecord[] {
    return readJournal(this.path);
  }

  append(partial: Omit<JournalRecord, "seq" | "at"> & { at?: string }): JournalRecord {
    const row: JournalRecord = {
      ...partial,
      seq: ++this.seq,
      at: partial.at ?? new Date().toISOString(),
    };
    const fd = openSync(this.path, "a");
    try {
      writeSync(fd, JSON.stringify(row) + "\n");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    return row;
  }
}
