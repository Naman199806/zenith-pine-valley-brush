/**
 * Position lifecycle owned by Apex Executor.
 * FLAT → ENTRY_PENDING → PARTIAL/OPEN → EXIT_PENDING → CLOSED/FLAT
 */

export type PositionState = "FLAT" | "ENTRY_PENDING" | "PARTIAL" | "OPEN" | "EXIT_PENDING" | "CLOSED";

const NEXT: Record<PositionState, PositionState[]> = {
  FLAT: ["ENTRY_PENDING"],
  ENTRY_PENDING: ["PARTIAL", "OPEN", "FLAT", "CLOSED"],
  PARTIAL: ["OPEN", "EXIT_PENDING", "CLOSED"],
  OPEN: ["EXIT_PENDING", "CLOSED"],
  EXIT_PENDING: ["CLOSED", "FLAT"],
  CLOSED: ["FLAT"],
};

export function transitionPosition(from: PositionState, to: PositionState): PositionState {
  if (!NEXT[from].includes(to)) throw new Error(`invalid lifecycle ${from} -> ${to}`);
  return to;
}

export interface LifecycleRecord {
  clientOrderId: string;
  state: PositionState;
  filledQty: number;
  linkedExitId: string | null;
  unknown: boolean;
}

export function applyBrokerStatus(rec: LifecycleRecord, status: string, filledQty: number): LifecycleRecord {
  if (status === "rejected" || status === "canceled") return { ...rec, state: transitionPosition(rec.state, "FLAT"), unknown: false };
  if (status === "unknown") return { ...rec, unknown: true };
  if (status === "partially_filled") return { ...rec, state: transitionPosition(rec.state === "FLAT" ? "ENTRY_PENDING" : rec.state, "PARTIAL"), filledQty };
  if (status === "filled" && rec.state === "EXIT_PENDING") return { ...rec, state: "CLOSED", filledQty, unknown: false };
  if (status === "filled") return { ...rec, state: transitionPosition(rec.state === "FLAT" ? "ENTRY_PENDING" : rec.state, "OPEN"), filledQty, unknown: false };
  return rec;
}
