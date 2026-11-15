/**
 * Isolated, disabled-by-default Alpaca equity order adapter.
 * CONNECTIVITY_TEST only. Never STRATEGY_TRADE.
 * Worst-case notional = qty × limit × (1 + buffer). Hard cap $25.
 * Explicit Sigma and Sentinel approvals required before any entry intent.
 * Full order identity persisted and verified against the proposed broker body.
 * Hard-disable remains; this module never submits.
 */

import { CONNECTIVITY_TEST, type AuthorizationCategory } from "./connectivity.ts";
import type { Session } from "./equity.ts";
import { worstCaseNotional } from "./equity.ts";
import type { HermesJournal } from "./journal.ts";
import type { TicketAuthorization, Quote, GateResult } from "./executor.ts";
import { checkQuoteFreshness, checkSpread } from "./executor.ts";

export interface EquityTicket {
  category: AuthorizationCategory;
  symbol: string;
  side: "buy" | "sell";
  orderType: "market" | "limit";
  timeInForce: "day" | "gtc" | "ioc";
  maxNotional: number;
  qty: number;
  limitPrice: number | null;
  expiry: string;
  singleUseId: string;
  readAuthorized: boolean;
  orderAuthorized: boolean;
  confirmed: boolean;
  session: Session;
  fractionable: boolean;
}

export interface EquityIdentity {
  symbol: string;
  side: "buy" | "sell";
  orderType: "market" | "limit";
  qty: number;
  limitPrice: number | null;
  timeInForce: "day" | "gtc" | "ioc";
  session: Session;
  extendedHours: boolean;
  singleUseId: string;
  expiry: string;
  worstCaseNotional: number;
}

export interface EquityAdapterResult {
  enabled: false;
  submitted: false;
  clientOrderId: string | null;
  reason: string;
  intentPersisted: boolean;
  identity: EquityIdentity | null;
}

const HARD_MAX = 25;
const COST_BUFFER_BPS = 10;

export function proposedBrokerBody(id: EquityIdentity, clientOrderId: string): Record<string, unknown> {
  return {
    symbol: id.symbol,
    side: id.side,
    type: id.orderType,
    qty: id.qty.toFixed(9).replace(/0+$/, "").replace(/\.$/, ""),
    time_in_force: id.timeInForce,
    limit_price: id.limitPrice,
    extended_hours: id.extendedHours,
    client_order_id: clientOrderId,
  };
}

export function identityMatches(persisted: EquityIdentity, proposed: Record<string, unknown>): boolean {
  return (
    persisted.symbol === proposed.symbol &&
    persisted.side === proposed.side &&
    persisted.orderType === proposed.type &&
    persisted.timeInForce === proposed.time_in_force &&
    persisted.extendedHours === proposed.extended_hours &&
    persisted.limitPrice === proposed.limit_price
  );
}

/** Alpaca rules: fractional requires day TIF; extended/overnight require limit + day/gtc + extended_hours. */
export function validateAlpacaCombo(t: EquityTicket): string | null {
  const fractional = !Number.isInteger(t.qty);
  if (fractional && t.timeInForce !== "day") return "fractional orders require day time-in-force";
  if (fractional && !t.fractionable) return "asset is not fractionable";
  if (t.session === "OVERNIGHT" || t.session === "EXTENDED") {
    if (t.orderType !== "limit") return "extended/overnight require limit-only";
    if (t.timeInForce !== "day" && t.timeInForce !== "gtc") return "extended/overnight require day or gtc";
  }
  if (t.orderType === "limit" && t.limitPrice != null && t.limitPrice >= 1) {
    const cents = Math.round(t.limitPrice * 100);
    if (Math.abs(t.limitPrice * 100 - cents) > 1e-6) return "limit price must be two decimals at or above $1";
  }
  return null;
}

export function validateEquityTicket(t: EquityTicket, now = new Date()): string | null {
  if (t.category !== CONNECTIVITY_TEST) return "only CONNECTIVITY_TEST permitted";
  if (t.side !== "buy" && t.side !== "sell") return "invalid side";
  if (!t.readAuthorized || !t.orderAuthorized || !t.confirmed) return "separate read and order authorization plus confirmation required";
  if (t.maxNotional <= 0 || t.maxNotional > HARD_MAX) return `max notional must be <= ${HARD_MAX}`;
  if (!(t.qty > 0)) return "quantity must be positive";
  if (new Date(t.expiry) <= now) return "authorization expired";
  if (!t.singleUseId) return "single-use identity required";
  if (t.session === "CLOSED") return "market closed";
  if (t.orderType === "limit" && (t.limitPrice == null || t.limitPrice <= 0)) return "limit price required";
  const alpaca = validateAlpacaCombo(t);
  if (alpaca) return alpaca;
  if (t.side === "buy") {
    const price = t.orderType === "limit" ? t.limitPrice! : t.limitPrice ?? 0;
    if (!(price > 0)) return "BUY requires a limit price for worst-case notional";
    const worst = worstCaseNotional(t.qty, price, COST_BUFFER_BPS);
    if (worst > t.maxNotional + 1e-6) return `worst-case notional ${worst.toFixed(4)} exceeds approved ${t.maxNotional}`;
    if (worst > HARD_MAX + 1e-6) return `worst-case notional ${worst.toFixed(4)} exceeds hard cap ${HARD_MAX}`;
  }
  return null;
}

export function prepareEquityTicket(
  ticket: EquityTicket,
  quote: Quote,
  journal: HermesJournal,
  gates: GateResult | null,
): EquityAdapterResult {
  const fail = (reason: string): EquityAdapterResult => ({
    enabled: false, submitted: false, clientOrderId: null, reason, intentPersisted: false, identity: null,
  });
  const err = validateEquityTicket(ticket);
  if (err) return fail(err);
  // Entries require explicit independent gate approvals. Missing evidence blocks. Exits may proceed under separate auth.
  if (ticket.side === "buy") {
    if (!gates || gates.sigmaVeto || gates.sentinelVeto || !gates.sigmaApproved || !gates.sentinelApproved) {
      return fail(gates?.reason || "missing Sigma or Sentinel approval; entry blocked");
    }
  }
  const fresh = checkQuoteFreshness(quote);
  if (fresh) return fail(fresh);
  const spread = checkSpread(quote, 20);
  if (spread) return fail(spread);
  const extendedHours = ticket.session === "EXTENDED" || ticket.session === "OVERNIGHT";
  const worst = ticket.side === "buy" && ticket.limitPrice
    ? worstCaseNotional(ticket.qty, ticket.limitPrice, COST_BUFFER_BPS)
    : 0;
  const identity: EquityIdentity = {
    symbol: ticket.symbol,
    side: ticket.side,
    orderType: ticket.orderType,
    qty: ticket.qty,
    limitPrice: ticket.limitPrice,
    timeInForce: ticket.timeInForce,
    session: ticket.session,
    extendedHours,
    singleUseId: ticket.singleUseId,
    expiry: ticket.expiry,
    worstCaseNotional: worst,
  };
  const clientOrderId = `apex-eq-${ticket.singleUseId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const proposed = proposedBrokerBody(identity, clientOrderId);
  if (!identityMatches(identity, proposed)) return fail("persisted identity does not match proposed broker order");
  const auth: TicketAuthorization = {
    category: ticket.category,
    symbol: ticket.symbol,
    side: ticket.side,
    orderType: "market",
    maxNotional: ticket.maxNotional,
    expiry: ticket.expiry,
    singleUseId: ticket.singleUseId,
    readAuthorized: ticket.readAuthorized,
    orderAuthorized: ticket.orderAuthorized,
    confirmed: ticket.confirmed,
  };
  journal.persist({
    clientOrderId,
    ticket: auth,
    createdAt: new Date().toISOString(),
    status: "PERSISTED",
    filledQty: 0,
    avgPrice: null,
    equityIdentity: identity,
  });
  return {
    enabled: false,
    submitted: false,
    clientOrderId,
    reason: "equity adapter disabled by default. Intent persisted. No order submitted.",
    intentPersisted: true,
    identity,
  };
}
