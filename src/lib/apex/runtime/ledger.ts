import { createHash } from "node:crypto";
import { existsSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync, closeSync } from "node:fs";
import { dirname } from "node:path";

export const SCHEMA = 1;

export interface Fill {
  executionId: string;
  clientOrderId: string;
  side: "buy" | "sell";
  qty: number;
  price: number;
  fee: number;
  at: string;
}

export interface Ledger {
  schema: number;
  startCash: number;
  fills: Fill[];
  position: number;
  cash: number;
  realized: number;
  entriesBlocked: boolean;
  alert: string | null;
  checksum: string;
}

function body(state: Omit<Ledger, "checksum">): string {
  return JSON.stringify({ schema: state.schema, startCash: state.startCash, fills: state.fills, position: state.position, cash: state.cash, realized: state.realized, entriesBlocked: state.entriesBlocked, alert: state.alert });
}

function checksum(state: Omit<Ledger, "checksum">): string {
  return createHash("sha256").update(body(state)).digest("hex");
}

export function emptyLedger(cash = 1000): Ledger {
  const state = { schema: SCHEMA, startCash: cash, fills: [], position: 0, cash, realized: 0, entriesBlocked: false, alert: null };
  return { ...state, checksum: checksum(state) };
}

export function applyFill(state: Ledger, fill: Fill): Ledger {
  if (state.fills.some((f) => f.executionId === fill.executionId)) return state;
  const fills = [...state.fills, fill].sort((a, b) => a.at.localeCompare(b.at) || a.executionId.localeCompare(b.executionId));
  const rebuilt = rebuild(fills, state.startCash);
  const next = { ...rebuilt, startCash: state.startCash, entriesBlocked: state.entriesBlocked, alert: state.alert };
  return { ...next, checksum: checksum(next) };
}

export function rebuild(fills: Fill[], startCash: number): Omit<Ledger, "checksum" | "entriesBlocked" | "alert" | "startCash"> {
  let cash = startCash, position = 0, cost = 0, realized = 0;
  for (const fill of fills) {
    if (fill.side === "buy") {
      cash -= fill.qty * fill.price + fill.fee;
      cost += fill.qty * fill.price + fill.fee;
      position += fill.qty;
    } else {
      const avg = position ? cost / position : fill.price;
      realized += fill.qty * (fill.price - avg) - fill.fee;
      cash += fill.qty * fill.price - fill.fee;
      cost -= avg * fill.qty;
      position -= fill.qty;
    }
  }
  return { schema: SCHEMA, fills, position: Math.round(position * 1e8) / 1e8, cash: Math.round(cash * 100) / 100, realized: Math.round(realized * 100) / 100 };
}

export function saveAtomic(path: string, state: Ledger): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const lock = `${path}.lock`;
  if (existsSync(lock)) throw new Error("ledger writer already active");
  const fd = openSync(lock, "wx");
  closeSync(fd);
  try {
    const tmp = `${path}.tmp`;
    const stamped = { ...state, checksum: checksum(state) };
    writeFileSync(tmp, JSON.stringify(stamped, null, 2));
    renameSync(tmp, path);
  } finally {
    try { renameSync(lock, `${lock}.released`); } catch { /* lock cleanup is best effort */ }
  }
}

export function loadChecked(path: string): Ledger {
  if (!existsSync(path)) throw new Error("ledger missing; refusing to invent an empty account");
  const raw = readFileSync(path, "utf8");
  let parsed: Ledger;
  try { parsed = JSON.parse(raw); } catch { throw new Error("corrupted ledger; refusing to reset"); }
  if (parsed.schema !== SCHEMA) throw new Error("unsupported ledger schema");
  const expected = checksum(parsed);
  if (parsed.checksum !== expected) throw new Error("ledger checksum mismatch");
  return parsed;
}

export function validateOrder(input: { symbol: string; qty: number; price: number; cash: number; increment: number; minNotional: number; feeRate: number }): { ok: boolean; reason: string } {
  if (!(input.qty > 0) || !(input.price > 0)) return { ok: false, reason: "quantity and price must be positive" };
  const steps = Math.round(input.qty / input.increment);
  if (Math.abs(steps * input.increment - input.qty) > 1e-10) return { ok: false, reason: "quantity is not on the instrument increment" };
  const notional = input.qty * input.price;
  const fee = notional * input.feeRate;
  if (notional < input.minNotional) return { ok: false, reason: "below minimum notional" };
  if (notional + fee > input.cash) return { ok: false, reason: "insufficient buying power after fees" };
  return { ok: true, reason: "valid" };
}
