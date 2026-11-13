export type BrokerOrderState =
  | "created"
  | "risk_approved"
  | "submitted"
  | "accepted"
  | "partially_filled"
  | "filled"
  | "pending_cancel"
  | "canceled"
  | "rejected"
  | "expired"
  | "unknown_pending_reconciliation";

const NEXT: Record<BrokerOrderState, readonly BrokerOrderState[]> = {
  created: ["risk_approved", "rejected"],
  risk_approved: ["submitted", "rejected"],
  submitted: ["accepted", "partially_filled", "filled", "rejected", "canceled", "expired", "unknown_pending_reconciliation"],
  accepted: ["partially_filled", "filled", "pending_cancel", "canceled", "rejected", "expired", "unknown_pending_reconciliation"],
  partially_filled: ["partially_filled", "filled", "pending_cancel", "canceled", "expired", "unknown_pending_reconciliation"],
  filled: [],
  pending_cancel: ["canceled", "filled", "partially_filled", "unknown_pending_reconciliation"],
  canceled: [],
  rejected: [],
  expired: [],
  unknown_pending_reconciliation: ["accepted", "partially_filled", "filled", "pending_cancel", "canceled", "rejected", "expired"],
};

export function transition(from: BrokerOrderState, to: BrokerOrderState): BrokerOrderState {
  if (from === to && (from === "partially_filled" || from === "unknown_pending_reconciliation")) return from;
  if (!NEXT[from].includes(to)) throw new Error(`Illegal order transition ${from} -> ${to}.`);
  return to;
}

export function mapBrokerStatus(status: string): BrokerOrderState {
  switch (status) {
    case "new":
    case "accepted":
    case "pending_new":
    case "accepted_for_bidding":
      return "accepted";
    case "partially_filled":
      return "partially_filled";
    case "filled":
      return "filled";
    case "pending_cancel":
    case "pending_replace":
      return "pending_cancel";
    case "canceled":
    case "replaced":
      return "canceled";
    case "rejected":
      return "rejected";
    case "expired":
    case "done_for_day":
      return "expired";
    default:
      return "unknown_pending_reconciliation";
  }
}

export function isTerminal(state: BrokerOrderState): boolean {
  return state === "filled" || state === "canceled" || state === "rejected" || state === "expired";
}
