/**
 * Broker reconciliation is authoritative.
 * PROPOSED means nothing was transmitted.
 * SUBMISSION_ATTEMPTED with a missing or bad lookup is UNKNOWN, never FLAT.
 * A partial fill stays owned across cancellation.
 */

import type { OrderState } from "./order-machine.ts";

export type PositionState =
  | "PROPOSED"
  | "SUBMISSION_ATTEMPTED"
  | "PARTIAL"
  | "OPEN"
  | "EXIT_PENDING"
  | "FLAT"
  | "UNKNOWN"
  | "CLOSED";

export interface LifecycleRecord {
  clientOrderId: string;
  symbol: "SPY" | "QQQ" | "IWM";
  side: "buy" | "sell";
  qty: number;
  state: PositionState;
  filledQty: number;
  linkedExitId: string | null;
  linkedEntryId: string | null;
  unknown: boolean;
  alerted: boolean;
  /** True only after a submission attempt was recorded. Accept never sets this. */
  submitted: boolean;
  expiresAt: string;
  /** Parallel order machine. Absent on snapshots written before that machine. */
  orderState?: OrderState;
  nonce?: string | null;
  avgPrice?: number | null;
  brokerOrderId?: string | null;
  confirmedAbsent?: boolean;
  notional?: number | null;
}

export interface LookupFacts {
  orderStatus: number;
  orderBody: unknown;
  positionsStatus: number;
  positions: unknown;
  openStatus: number;
  openOrders: unknown;
}

export function markUnknown(rec: LifecycleRecord): LifecycleRecord {
  return { ...rec, state: "UNKNOWN", unknown: true, alerted: true };
}

export function onObservedFill(rec: LifecycleRecord, filledQty: number): LifecycleRecord {
  if (!(filledQty >= 0) || !Number.isFinite(filledQty)) throw new Error("nonfinite fill");
  if (filledQty + 1e-12 < rec.filledQty) throw new Error("fill decreased");
  if (filledQty === 0) return { ...rec, filledQty: rec.filledQty, unknown: false };
  const state: PositionState = filledQty + 1e-12 < rec.qty ? "PARTIAL" : "OPEN";
  return { ...rec, state, filledQty, unknown: false };
}

function ownedOf(rec: LifecycleRecord, positions: { symbol?: string; qty?: string }[]): number | null {
  const row = positions.find((position) => position.symbol === rec.symbol);
  if (!row) return 0;
  const qty = Number(row.qty);
  if (!Number.isFinite(qty) || qty < 0) return null;
  return qty;
}

/**
 * Missing, non-200, or inconsistent order lookups are UNKNOWN.
 * A PROPOSED instruction that was never submitted stays PROPOSED on 404.
 * Empty position arrays do not by themselves mean FLAT.
 */
export function reconcileRecord(rec: LifecycleRecord, facts: LookupFacts): LifecycleRecord {
  const positionsOk = facts.positionsStatus === 200 && Array.isArray(facts.positions);
  const openOk = facts.openStatus === 200 && Array.isArray(facts.openOrders);
  if (!positionsOk || !openOk) return markUnknown(rec);

  const orderPresent = facts.orderStatus === 200 && !!facts.orderBody && typeof facts.orderBody === "object" && "filled_qty" in (facts.orderBody as object);
  if (!orderPresent) {
    if (facts.orderStatus === 404 && rec.state === "PROPOSED" && rec.submitted === false) {
      return { ...rec, state: "PROPOSED", unknown: false, alerted: false };
    }
    return markUnknown(rec);
  }

  const body = facts.orderBody as { filled_qty?: string; status?: string };
  const observed = Number(body.filled_qty);
  const status = String(body.status ?? "");
  if (!Number.isFinite(observed) || observed < 0) return markUnknown(rec);
  const owned = ownedOf(rec, facts.positions as { symbol?: string; qty?: string }[]);
  if (owned == null) return markUnknown(rec);
  const openCount = (facts.openOrders as unknown[]).length;
  if (observed + 1e-12 < rec.filledQty) return markUnknown(rec);
  const filled = Math.max(rec.filledQty, observed);
  const canceled = status === "canceled" || status === "cancelled" || status === "expired";

  if (rec.side === "sell" && status === "filled" && observed + 1e-12 >= rec.qty && owned === 0 && openCount === 0) {
    return { ...rec, state: "FLAT", filledQty: observed, unknown: false, alerted: false };
  }
  if (rec.side === "sell" && (status === "partially_filled" || (status === "filled" && observed + 1e-12 < rec.qty))) {
    if (!(owned > 0)) return markUnknown(rec);
    return { ...rec, state: "PARTIAL", filledQty: observed, unknown: false, alerted: false };
  }
  if (rec.side === "sell" && canceled) {
    return { ...rec, state: observed > 0 ? "PARTIAL" : "PROPOSED", filledQty: observed, unknown: false, alerted: false };
  }

  if (rec.side === "buy" && canceled && filled > 0 && owned === 0) return markUnknown(rec);
  if (rec.side === "buy" && canceled && owned > 0) {
    return { ...rec, state: owned + 1e-12 < rec.qty ? "PARTIAL" : "OPEN", filledQty: filled, unknown: false, alerted: false };
  }
  if (rec.side === "buy" && filled > 0 && owned > 0 && Math.abs(owned - filled) > 1e-6) return markUnknown(rec);

  if (owned > 0 && rec.side === "buy") {
    const state: PositionState = filled + 1e-12 < rec.qty ? "PARTIAL" : "OPEN";
    return { ...rec, state, filledQty: filled, unknown: false, alerted: false };
  }

  if (owned === 0 && openCount === 0 && filled === 0 && rec.state === "PROPOSED" && rec.submitted === false) {
    return { ...rec, state: "PROPOSED", unknown: false };
  }

  return markUnknown(rec);
}
