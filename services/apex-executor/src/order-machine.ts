/**
 * Order state machine for a supervised PAPER order.
 * Position lifecycle states stay in lifecycle.ts. This machine is the order.
 * Illegal transitions are refused. The caller journals the refusal.
 */

export const ORDER_STATES = [
  "intent",
  "submitted",
  "accepted",
  "partially_filled",
  "filled",
  "rejected",
  "canceled",
  "expired",
  "UNKNOWN",
] as const;

export type OrderState = (typeof ORDER_STATES)[number];

const NEXT: Record<OrderState, readonly OrderState[]> = {
  intent: ["submitted", "rejected", "canceled", "expired"],
  submitted: ["accepted", "partially_filled", "filled", "rejected", "canceled", "expired", "UNKNOWN"],
  accepted: ["partially_filled", "filled", "rejected", "canceled", "expired", "UNKNOWN"],
  partially_filled: ["partially_filled", "filled", "canceled", "expired", "UNKNOWN"],
  filled: [],
  rejected: [],
  canceled: [],
  expired: [],
  UNKNOWN: ["accepted", "partially_filled", "filled", "rejected", "canceled", "expired"],
};

export function isOrderState(value: unknown): value is OrderState {
  return typeof value === "string" && (ORDER_STATES as readonly string[]).includes(value);
}

/** Same-state refresh is idempotent. Anything else must be listed. */
export function transitionRefusal(from: OrderState, to: OrderState): string | null {
  if (from === to) return null;
  if (!NEXT[from].includes(to)) return `illegal order transition ${from} -> ${to}`;
  return null;
}

export function terminalOrder(state: OrderState): boolean {
  return state === "filled" || state === "rejected" || state === "canceled" || state === "expired";
}

export function orderStateFromBroker(status: string, filledQty: number): OrderState | null {
  const name = status.toLowerCase();
  if (name === "rejected") return "rejected";
  if (name === "canceled" || name === "cancelled") return "canceled";
  if (name === "expired") return "expired";
  if (name === "filled") return "filled";
  if (name === "partially_filled") return "partially_filled";
  if (name === "new" || name === "accepted" || name === "pending_new" || name === "accepted_for_bidding" || name === "stopped" || name === "calculated") {
    return filledQty > 0 ? "partially_filled" : "accepted";
  }
  return null;
}

/**
 * Cumulative qty and average. A repeated snapshot with the same qty keeps the
 * average. A decrease is refused. The average moves only when qty increases.
 */
export function applyCumulativeFill(
  prevQty: number,
  prevAvg: number | null,
  nextQty: number,
  nextAvg: number | null,
): { ok: true; qty: number; avg: number | null } | { ok: false; reason: string } {
  if (!Number.isFinite(prevQty) || prevQty < 0 || !Number.isFinite(nextQty) || nextQty < 0) return { ok: false, reason: "nonfinite fill" };
  if (nextQty + 1e-12 < prevQty) return { ok: false, reason: "fill decreased" };
  if (Math.abs(nextQty - prevQty) <= 1e-12) {
    if (nextAvg != null && prevAvg != null && Number.isFinite(nextAvg) && Number.isFinite(prevAvg) && Math.abs(nextAvg - prevAvg) > 1e-6) {
      return { ok: false, reason: "average changed without quantity" };
    }
    return { ok: true, qty: prevQty, avg: prevAvg ?? (nextAvg != null && Number.isFinite(nextAvg) && nextAvg > 0 ? nextAvg : null) };
  }
  if (nextAvg == null || !Number.isFinite(nextAvg) || !(nextAvg > 0)) return { ok: false, reason: "missing average" };
  return { ok: true, qty: nextQty, avg: nextAvg };
}

export function inFlightOrder(rec: { orderState?: OrderState | null; state: string; unknown: boolean; confirmedAbsent?: boolean; submitted?: boolean }): boolean {
  if (rec.confirmedAbsent) return false;
  if (rec.orderState === "submitted" || rec.orderState === "accepted" || rec.orderState === "partially_filled" || rec.orderState === "UNKNOWN") return true;
  if (rec.unknown || rec.state === "UNKNOWN" || rec.state === "SUBMISSION_ATTEMPTED") return true;
  return false;
}
