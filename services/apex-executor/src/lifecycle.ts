/**
 * Position lifecycle. Broker reconciliation is authoritative.
 * A partial BUY cannot become FLAT until positions and open orders are both zero.
 */

export type PositionState = "PROPOSED" | "FLAT" | "ENTRY_PENDING" | "PARTIAL" | "OPEN" | "EXIT_PENDING" | "UNKNOWN" | "CLOSED";

export interface LifecycleRecord {
  clientOrderId: string;
  state: PositionState;
  filledQty: number;
  linkedExitId: string | null;
  unknown: boolean;
  alerted: boolean;
}

export function onObservedFill(rec: LifecycleRecord, filledQty: number): LifecycleRecord {
  if (!(filledQty >= 0) || !Number.isFinite(filledQty)) throw new Error("nonfinite fill");
  if (filledQty > 0 && filledQty < rec.filledQty) throw new Error("fill decreased");
  const state: PositionState = filledQty === 0 ? rec.state : filledQty > 0 && rec.state === "ENTRY_PENDING" ? "PARTIAL" : rec.state;
  return { ...rec, state, filledQty, unknown: false };
}

export function markUnknown(rec: LifecycleRecord): LifecycleRecord {
  return { ...rec, state: "UNKNOWN", unknown: true, alerted: true };
}

export function reconcileToBroker(rec: LifecycleRecord, ownedQty: number, openOrders: number): LifecycleRecord {
  if (!Number.isFinite(ownedQty) || ownedQty < 0 || !Number.isFinite(openOrders) || openOrders < 0) {
    return markUnknown(rec);
  }
  if (ownedQty === 0 && openOrders === 0) return { ...rec, state: "FLAT", filledQty: 0, unknown: false };
  if (ownedQty > 0 && rec.state === "EXIT_PENDING") return { ...rec, state: "PARTIAL", filledQty: ownedQty };
  if (ownedQty > 0) return { ...rec, state: ownedQty < rec.filledQty ? "PARTIAL" : "OPEN", filledQty: ownedQty, unknown: false };
  return { ...rec, state: "UNKNOWN", unknown: true, alerted: true };
}
