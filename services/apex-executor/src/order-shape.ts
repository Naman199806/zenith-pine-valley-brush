/**
 * Supervised SPY order shape.
 *
 * The operator signature stays the existing limit ticket. Alpaca's notional
 * field is a market day order, so the signed limit price is the notional
 * bound and is not sent as a limit price.
 *
 * Fractional trading: https://docs.alpaca.markets/us/docs/fractional-trading
 *   $1 minimum, notional and qty are mutually exclusive, notional has at most
 *   2 decimal places, qty has at most 9, fractional sells are not shorts.
 * Create an order: https://docs.alpaca.markets/us/reference/postorder
 *   notional cannot be combined with qty and is only valid for type=market
 *   and time_in_force=day.
 * Trading API overview: https://docs.alpaca.markets/us/docs/trading-api
 *   "We only allow market orders for fractional trading at the moment."
 * A day order is regular hours unless extended_hours is set. This shape
 * sets extended_hours false and the caller also requires the broker clock.
 */

export const FRACTIONAL_TRADING_DOC = "https://docs.alpaca.markets/us/docs/fractional-trading";
export const POST_ORDER_DOC = "https://docs.alpaca.markets/us/reference/postorder";
export const TRADING_API_DOC = "https://docs.alpaca.markets/us/docs/trading-api";

export const MIN_NOTIONAL_USD = 1;
export const MAX_NOTIONAL_USD = 25;

/** Under 48 characters. The signed id is the broker id, so it is stable. */
export const CLIENT_ORDER_ID_PATTERN = /^[A-Za-z0-9_-]{1,47}$/;

export function clientOrderIdProblem(id: string): string | null {
  if (typeof id !== "string" || !CLIENT_ORDER_ID_PATTERN.test(id)) {
    return "client_order_id must be 1 to 47 characters of letters, digits, underscore, or hyphen";
  }
  return null;
}

/** Exact cents. Values above $25 or below $1 are refused, not rounded into range. */
export function formatNotional(amount: number): string | null {
  if (!Number.isFinite(amount) || amount < MIN_NOTIONAL_USD || amount > MAX_NOTIONAL_USD) return null;
  const cents = Math.round(amount * 100);
  if (Math.abs(amount * 100 - cents) > 1e-6) return null;
  if (cents < 100 || cents > 2_500) return null;
  return (cents / 100).toFixed(2);
}

/** Truncate toward zero at 9 decimal places so a sell cannot round up. */
export function formatFractionalQty(qty: number): string | null {
  if (!Number.isFinite(qty) || !(qty > 0)) return null;
  const units = Math.floor(qty * 1e9 + 1e-6);
  if (units <= 0) return null;
  const text = (units / 1e9).toFixed(9).replace(/0+$/, "").replace(/\.$/, "");
  return text.length > 0 ? text : null;
}

export interface SpyNotionalBuy {
  symbol: "SPY";
  side: "buy";
  type: "market";
  time_in_force: "day";
  extended_hours: false;
  notional: string;
  client_order_id: string;
}

export interface SpyFractionalSell {
  symbol: "SPY";
  side: "sell";
  type: "market";
  time_in_force: "day";
  extended_hours: false;
  qty: string;
  client_order_id: string;
}

export function spyNotionalBuy(clientOrderId: string, notional: number): { ok: true; order: SpyNotionalBuy } | { ok: false; reason: string } {
  const id = clientOrderIdProblem(clientOrderId);
  if (id) return { ok: false, reason: id };
  if (notional > MAX_NOTIONAL_USD) return { ok: false, reason: "notional exceeds $25" };
  const formatted = formatNotional(notional);
  if (!formatted) return { ok: false, reason: "notional must be between $1 and $25 in cents" };
  return {
    ok: true,
    order: {
      symbol: "SPY",
      side: "buy",
      type: "market",
      time_in_force: "day",
      extended_hours: false,
      notional: formatted,
      client_order_id: clientOrderId,
    },
  };
}

export function spyFractionalSell(clientOrderId: string, qty: number): { ok: true; order: SpyFractionalSell } | { ok: false; reason: string } {
  const id = clientOrderIdProblem(clientOrderId);
  if (id) return { ok: false, reason: id };
  const formatted = formatFractionalQty(qty);
  if (!formatted) return { ok: false, reason: "sell quantity invalid" };
  return {
    ok: true,
    order: {
      symbol: "SPY",
      side: "sell",
      type: "market",
      time_in_force: "day",
      extended_hours: false,
      qty: formatted,
      client_order_id: clientOrderId,
    },
  };
}
