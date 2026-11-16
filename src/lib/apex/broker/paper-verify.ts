/**
 * GET-only verification of existing PAPER orders.
 * Never submits. Never selects the LIVE host.
 */

export interface PaperOrderView {
  id: string;
  client_order_id: string;
  symbol: string;
  side: "buy" | "sell";
  status: string;
  filled_qty: string;
}

export interface PaperVerifyResult {
  verified: boolean;
  host: "paper-api.alpaca.markets";
  method: "GET";
  submitted: false;
  blockers: string[];
  orders: PaperOrderView[];
  positions: number | null;
  openOrders: number | null;
}

export function verifyPaperOrders(input: {
  authorized: boolean;
  host: string;
  orders: PaperOrderView[];
  positions: unknown[];
  openOrders: unknown[];
}): PaperVerifyResult {
  const blockers: string[] = [];
  if (!input.authorized) blockers.push("operator GET authorization required");
  if (input.host !== "paper-api.alpaca.markets") blockers.push("LIVE host rejected");
  for (const o of input.orders) {
    if (!o.id || !o.filled_qty) blockers.push(`incomplete order ${o.id || "unknown"}`);
  }
  return {
    verified: blockers.length === 0,
    host: "paper-api.alpaca.markets",
    method: "GET",
    submitted: false,
    blockers,
    orders: input.orders,
    positions: input.positions.length,
    openOrders: input.openOrders.length,
  };
}

export interface PreparedEquityTicket {
  status: "PREPARED_NOT_AUTHORIZED";
  symbols: ["SPY", "QQQ", "IWM"];
  orderType: "limit";
  maxEntryNotional: 25;
  requiresFreshQuote: true;
  reusableSnapshot: false;
  independentExitAuth: true;
  durableJournal: true;
  uniqueClientOrderId: true;
  restartReconciliation: true;
  submitted: false;
  executionAuthorized: false;
}

export function prepareEquityPaperTicket(): PreparedEquityTicket {
  return {
    status: "PREPARED_NOT_AUTHORIZED",
    symbols: ["SPY", "QQQ", "IWM"],
    orderType: "limit",
    maxEntryNotional: 25,
    requiresFreshQuote: true,
    reusableSnapshot: false,
    independentExitAuth: true,
    durableJournal: true,
    uniqueClientOrderId: true,
    restartReconciliation: true,
    submitted: false,
    executionAuthorized: false,
  };
}
