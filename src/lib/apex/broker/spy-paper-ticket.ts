/**
 * Supervised SPY PAPER LIMIT workflow. Not authorized. Never submits.
 * Regular session preferred. Fractional qty requires day TIF.
 * Worst-case entry notional capped at $25. Exit requires a distinct authorization.
 */

export interface SpyPaperTicket {
  symbol: "SPY";
  side: "buy" | "sell";
  orderType: "limit";
  timeInForce: "day";
  qty: number;
  limitPrice: number;
  session: "REGULAR";
  maxEntryNotional: 25;
  operatorAuthorized: boolean;
  exitAuthorizationId: string | null;
  clientOrderId: string;
}

export function validateSpyPaperTicket(t: SpyPaperTicket): string | null {
  if (t.symbol !== "SPY") return "only SPY in this prepared workflow";
  if (t.orderType !== "limit") return "PAPER equity ticket must be limit";
  if (t.timeInForce !== "day") return "fractional and prepared tickets require day";
  if (t.session !== "REGULAR") return "regular session required for this workflow";
  if (!(t.qty > 0) || !Number.isFinite(t.qty)) return "quantity invalid";
  if (!Number.isInteger(t.qty) && t.timeInForce !== "day") return "fractional requires day";
  if (!(t.limitPrice > 0) || !Number.isFinite(t.limitPrice)) return "limit price invalid";
  const worst = t.qty * t.limitPrice * 1.001;
  if (t.side === "buy" && worst > t.maxEntryNotional) return "worst-case entry exceeds $25";
  if (!t.operatorAuthorized) return "operator authorization required";
  if (t.side === "sell" && !t.exitAuthorizationId) return "independent exit authorization required";
  if (!t.clientOrderId) return "unique client order id required";
  return null;
}

export function prepareSpyPaperBuy(): SpyPaperTicket {
  return {
    symbol: "SPY",
    side: "buy",
    orderType: "limit",
    timeInForce: "day",
    qty: 0.03,
    limitPrice: 750,
    session: "REGULAR",
    maxEntryNotional: 25,
    operatorAuthorized: false,
    exitAuthorizationId: null,
    clientOrderId: "apex-spy-paper-prepared",
  };
}
