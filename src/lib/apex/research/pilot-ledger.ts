export interface BrokerOrder {
  client_order_id: string;
  side: "buy" | "sell";
  status: string;
  submitted_at: string;
  filled_qty?: string;
}

export function pilotEntryCount(orders: BrokerOrder[], activatedAtUtc: string): number {
  const start = Date.parse(activatedAtUtc);
  return orders.filter((o) =>
    o.side === "buy" &&
    o.status === "filled" &&
    String(o.client_order_id || "").startsWith("apex-") &&
    Date.parse(o.submitted_at) >= start
  ).length;
}

export function recoverRejectedEntry(intentId: string, brokerStatus: string | null): "REJECTED_NO_RETRY" | "LOOKUP_REQUIRED" | "FILLED" {
  if (!intentId) return "LOOKUP_REQUIRED";
  if (brokerStatus === "rejected" || brokerStatus === "canceled" || brokerStatus === "expired") return "REJECTED_NO_RETRY";
  if (brokerStatus === "filled") return "FILLED";
  return "LOOKUP_REQUIRED";
}
