/**
 * Isolated, disabled-by-default Alpaca equity order adapter.
 * CONNECTIVITY_TEST only. Never STRATEGY_TRADE.
 * Long-only, max $25, no leverage.
 * Limit-only for overnight. Intent persisted before any possible submission.
 * Hard-disable remains; this module never submits.
 */

import { CONNECTIVITY_TEST, type AuthorizationCategory } from "./connectivity.ts";
import type { Session } from "./equity.ts";
import type { HermesJournal } from "./journal.ts";
import type { TicketAuthorization, Quote, GateResult } from "./executor.ts";
import { evaluateGates, checkQuoteFreshness, checkSpread } from "./executor.ts";

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
}

export interface EquityAdapterResult {
  enabled: false;
  submitted: false;
  clientOrderId: string | null;
  reason: string;
  intentPersisted: boolean;
}

const HARD_MAX = 25;

export function validateEquityTicket(t: EquityTicket, now = new Date()): string | null {
  if (t.category !== CONNECTIVITY_TEST) return "only CONNECTIVITY_TEST permitted";
  if (t.side !== "buy" && t.side !== "sell") return "invalid side";
  if (t.side === "sell") {
    /* risk-reducing exit allowed under separate auth */
  }
  if (!t.readAuthorized || !t.orderAuthorized || !t.confirmed) return "separate read and order authorization plus confirmation required";
  if (t.maxNotional <= 0 || t.maxNotional > HARD_MAX) return `max notional must be <= ${HARD_MAX}`;
  if (!(t.qty > 0)) return "quantity must be positive";
  if (new Date(t.expiry) <= now) return "authorization expired";
  if (!t.singleUseId) return "single-use identity required";
  if (t.session === "CLOSED") return "market closed";
  if (t.session === "OVERNIGHT") {
    if (t.orderType !== "limit" || t.limitPrice == null) return "overnight requires limit-only";
  }
  if (t.session === "EXTENDED" && t.orderType === "market") return "extended hours require limit";
  if (t.orderType === "limit" && (t.limitPrice == null || t.limitPrice <= 0)) return "limit price required";
  return null;
}

export function prepareEquityTicket(
  ticket: EquityTicket,
  quote: Quote,
  journal: HermesJournal,
  gates: GateResult = { sigmaVeto: false, sentinelVeto: false, reason: null },
): EquityAdapterResult {
  const err = validateEquityTicket(ticket);
  if (err) return { enabled: false, submitted: false, clientOrderId: null, reason: err, intentPersisted: false };
  if (gates.sigmaVeto || gates.sentinelVeto) {
    return { enabled: false, submitted: false, clientOrderId: null, reason: gates.reason || "gate veto", intentPersisted: false };
  }
  const fresh = checkQuoteFreshness(quote);
  if (fresh) return { enabled: false, submitted: false, clientOrderId: null, reason: fresh, intentPersisted: false };
  const spread = checkSpread(quote, 20);
  if (spread) return { enabled: false, submitted: false, clientOrderId: null, reason: spread, intentPersisted: false };
  const clientOrderId = `apex-eq-${ticket.singleUseId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
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
  });
  return {
    enabled: false,
    submitted: false,
    clientOrderId,
    reason: "equity adapter disabled by default. Intent persisted. No order submitted.",
    intentPersisted: true,
  };
}

export { evaluateGates };
