/**
 * Order lifecycle on top of the existing broker state machine.
 * authorized is local-only (nothing has been sent). Every later move
 * goes through machine.transition, including UNKNOWN.
 */

import { isTerminal, mapBrokerStatus, transition, type BrokerOrderState } from "../../../src/lib/apex/broker/machine.ts";

export type LifecycleState =
  | "authorized"
  | "submitted"
  | "accepted"
  | "partial_fill"
  | "filled"
  | "cancelled"
  | "rejected"
  | "expired"
  | "unknown";

const TO_MACHINE: Record<Exclude<LifecycleState, "authorized">, BrokerOrderState> = {
  submitted: "submitted",
  accepted: "accepted",
  partial_fill: "partially_filled",
  filled: "filled",
  cancelled: "canceled",
  rejected: "rejected",
  expired: "expired",
  unknown: "unknown_pending_reconciliation",
};

const FROM_MACHINE: Record<BrokerOrderState, LifecycleState> = {
  created: "authorized",
  risk_approved: "authorized",
  submitted: "submitted",
  accepted: "accepted",
  partially_filled: "partial_fill",
  filled: "filled",
  pending_cancel: "accepted",
  canceled: "cancelled",
  rejected: "rejected",
  expired: "expired",
  unknown_pending_reconciliation: "unknown",
};

export function toMachine(state: LifecycleState): BrokerOrderState {
  if (state === "authorized") return "risk_approved";
  return TO_MACHINE[state];
}

export function fromMachine(state: BrokerOrderState): LifecycleState {
  return FROM_MACHINE[state];
}

export function isTerminalState(state: LifecycleState): boolean {
  if (state === "authorized") return false;
  return isTerminal(toMachine(state));
}

export function nextLifecycle(from: LifecycleState, to: LifecycleState): LifecycleState {
  if (from === to) return to;
  if (from === "authorized") {
    const allowed: LifecycleState[] = ["submitted", "rejected", "unknown", "accepted", "partial_fill", "filled", "cancelled", "expired"];
    if (!allowed.includes(to)) throw new Error(`invalid lifecycle ${from} -> ${to}`);
    return to;
  }
  return fromMachine(transition(toMachine(from), toMachine(to)));
}

export function lifecycleFromBrokerStatus(from: LifecycleState, brokerStatus: string): LifecycleState {
  if (from === "authorized") throw new Error("not submitted");
  const mapped = mapBrokerStatus(brokerStatus);
  const current = toMachine(from);
  if (current === mapped) return from;
  return fromMachine(transition(current, mapped));
}
