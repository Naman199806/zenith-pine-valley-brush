/**
 * Isolated, disabled-by-default Alpaca equity order adapter.
 * CONNECTIVITY_TEST only. Limit BUY only. Worst-case notional hard-capped at $25.
 * Session is recomputed from the execution timestamp and calendar evidence.
 * Entry requires a fresh, ticket-bound Sigma/Sentinel proof. Hand-built approvals are rejected.
 * SELL requires confirmed owned quantity and no conflicting exit. Distinct single-use id.
 * Hard-disable remains; this module never submits.
 */

import { CONNECTIVITY_TEST, type AuthorizationCategory } from "./connectivity.ts";
import type { Session, CalendarException } from "./equity.ts";
import { marketSession, worstCaseNotional } from "./equity.ts";
import type { HermesJournal } from "./journal.ts";
import type { TicketAuthorization, Quote, GateProof } from "./executor.ts";
import { checkQuoteFreshness, checkSpread, verifyGateProof } from "./executor.ts";

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

export interface PositionSnapshot {
  ownedQty: number;
  openExitQty: number;
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
    qty: id.qty,
    time_in_force: id.timeInForce,
    limit_price: id.limitPrice,
    extended_hours: id.extendedHours,
    session: id.session,
    expiry: id.expiry,
    single_use_id: id.singleUseId,
    client_order_id: clientOrderId,
  };
}

export function identityMatches(persisted: EquityIdentity, proposed: Record<string, unknown>): boolean {
  return (
    persisted.symbol === proposed.symbol &&
    persisted.side === proposed.side &&
    persisted.orderType === proposed.type &&
    persisted.qty === proposed.qty &&
    persisted.timeInForce === proposed.time_in_force &&
    persisted.extendedHours === proposed.extended_hours &&
    persisted.limitPrice === proposed.limit_price &&
    persisted.session === proposed.session &&
    persisted.expiry === proposed.expiry &&
    persisted.singleUseId === proposed.single_use_id
  );
}

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
  if (t.side === "buy" && t.orderType !== "limit") return "connectivity-test BUY must be limit";
  if (!t.readAuthorized || !t.orderAuthorized || !t.confirmed) return "separate read and order authorization plus confirmation required";
  if (t.maxNotional <= 0 || t.maxNotional > HARD_MAX) return `max notional must be <= ${HARD_MAX}`;
  if (!(t.qty > 0) || !Number.isFinite(t.qty)) return "quantity must be a positive finite number";
  if (new Date(t.expiry) <= now) return "authorization expired";
  if (!t.singleUseId) return "single-use identity required";
  if (t.session === "CLOSED") return "market closed";
  if (t.orderType === "limit" && (t.limitPrice == null || !(t.limitPrice > 0) || !Number.isFinite(t.limitPrice))) return "limit price required";
  const alpaca = validateAlpacaCombo(t);
  if (alpaca) return alpaca;
  if (t.side === "buy") {
    const worst = worstCaseNotional(t.qty, t.limitPrice!, COST_BUFFER_BPS);
    if (!Number.isFinite(worst)) return "worst-case notional not finite";
    if (worst > t.maxNotional + 1e-6) return `worst-case notional ${worst.toFixed(4)} exceeds approved ${t.maxNotional}`;
    if (worst > HARD_MAX + 1e-6) return `worst-case notional ${worst.toFixed(4)} exceeds hard cap ${HARD_MAX}`;
  }
  return null;
}

export function prepareEquityTicket(
  ticket: EquityTicket,
  quote: Quote,
  journal: HermesJournal,
  proof: GateProof | null,
  opts: {
    now?: Date;
    calendar: CalendarException[] | null;
    positions?: PositionSnapshot;
  },
): EquityAdapterResult {
  const fail = (reason: string): EquityAdapterResult => ({
    enabled: false, submitted: false, clientOrderId: null, reason, intentPersisted: false, identity: null,
  });
  if (opts.calendar == null) return fail("missing calendar evidence");
  const now = opts.now ?? new Date();
  const computed = marketSession(now, opts.calendar);
  if (computed !== ticket.session) return fail(`session mismatch: ticket ${ticket.session} vs computed ${computed}`);
  const err = validateEquityTicket(ticket, now);
  if (err) return fail(err);
  if (journal.isConsumed(ticket.singleUseId)) return fail("authorization already consumed");
  if (ticket.side === "buy") {
    const gateErr = verifyGateProof(proof, {
      singleUseId: ticket.singleUseId,
      symbol: ticket.symbol,
      side: ticket.side,
      qty: ticket.qty,
      limitPrice: ticket.limitPrice,
    }, now.getTime());
    if (gateErr) return fail(gateErr);
  }
  if (ticket.side === "sell") {
    const pos = opts.positions;
    if (!pos) return fail("SELL requires reconciled position snapshot");
    if (ticket.qty > pos.ownedQty + 1e-12) return fail("SELL exceeds confirmed owned quantity");
    if (pos.openExitQty > 0) return fail("conflicting open exit order");
  }
  const fresh = checkQuoteFreshness(quote, now.getTime());
  if (fresh) return fail(fresh);
  const spread = checkSpread(quote, 20);
  if (spread) return fail(spread);
  const extendedHours = computed === "EXTENDED" || computed === "OVERNIGHT";
  const worst = ticket.side === "buy" ? worstCaseNotional(ticket.qty, ticket.limitPrice!, COST_BUFFER_BPS) : 0;
  const identity: EquityIdentity = {
    symbol: ticket.symbol,
    side: ticket.side,
    orderType: ticket.orderType,
    qty: ticket.qty,
    limitPrice: ticket.limitPrice,
    timeInForce: ticket.timeInForce,
    session: computed,
    extendedHours,
    singleUseId: ticket.singleUseId,
    expiry: ticket.expiry,
    worstCaseNotional: worst,
  };
  const clientOrderId = `apex-eq-${ticket.singleUseId}-${now.getTime()}-${Math.random().toString(36).slice(2, 6)}`;
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
    createdAt: now.toISOString(),
    status: "PERSISTED",
    filledQty: 0,
    avgPrice: null,
    equityIdentity: identity,
  });
  journal.consumeAuthorization(ticket.singleUseId);
  return {
    enabled: false,
    submitted: false,
    clientOrderId,
    reason: "equity adapter disabled by default. Intent persisted. No order submitted.",
    intentPersisted: true,
    identity,
  };
}
