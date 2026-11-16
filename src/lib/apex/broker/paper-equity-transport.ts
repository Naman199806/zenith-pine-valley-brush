/**
 * Isolated Alpaca PAPER LIMIT adapter.
 * PAPER_POST_ENABLED is hard-false. Production cannot submit.
 * Operator approval is loaded from an operator-written record and verified
 * against APEX_OPERATOR_SECRET. This module cannot mint that approval.
 * Sigma and Sentinel are computed from broker inputs, not caller booleans.
 */

import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PAPER_TRADING_ORIGIN, assertPaperUrl } from "./allowlist.ts";
import type { HermesJournal } from "../live/journal.ts";
import type { IntentRecord } from "../live/executor.ts";

export const PAPER_POST_ENABLED = false;

export interface PaperLimitTicket {
  symbol: "SPY";
  side: "buy" | "sell";
  orderType: "limit";
  timeInForce: "day";
  qty: number;
  limitPrice: number;
  session: "REGULAR";
  clientOrderId: string;
  expiresAt: string;
  quoteTimestamp: string;
  quoteSpreadBps: number;
  bid: number;
  ask: number;
  exitAuthorizationId: string | null;
}

export interface BrokerInputs {
  accountActive: boolean;
  tradingBlocked: boolean;
  positions: number;
  openOrders: number;
  dataOk: boolean;
}

export interface OperatorApproval {
  source: "OPERATOR_FILE";
  clientOrderId: string;
  symbol: "SPY";
  side: "buy" | "sell";
  qty: number;
  limitPrice: number;
  session: "REGULAR";
  expiresAt: string;
  quoteTimestamp: string;
  proof: string;
}

export interface PaperTransportResult {
  enabled: false;
  submitted: false;
  host: "paper-api.alpaca.markets";
  clientOrderId: string | null;
  reason: string;
  intentPersisted: boolean;
  payload: Record<string, unknown> | null;
}

function digest(secret: string, material: string): string {
  return createHmac("sha256", secret).update(material).digest("hex");
}

function material(t: { symbol: string; side: string; qty: number; limitPrice: number; session: string; clientOrderId: string; expiresAt: string; quoteTimestamp: string }): string {
  return [t.symbol, t.side, "limit", "day", String(t.qty), String(t.limitPrice), t.session, t.clientOrderId, t.expiresAt, t.quoteTimestamp].join("|");
}

export function loadOperatorApproval(path: string): OperatorApproval | null {
  try {
    const doc = JSON.parse(readFileSync(path, "utf8"));
    if (doc.source !== "OPERATOR_FILE") return null;
    return doc as OperatorApproval;
  } catch {
    return null;
  }
}

export function verifyOperatorApproval(ticket: PaperLimitTicket, approval: OperatorApproval | null, secret: string | null, now = Date.now()): string | null {
  if (!secret) return "operator secret not present; agent cannot mint approval";
  if (!approval || approval.source !== "OPERATOR_FILE") return "operator approval file required";
  if (approval.clientOrderId !== ticket.clientOrderId || approval.symbol !== ticket.symbol || approval.side !== ticket.side) return "approval identity mismatch";
  if (approval.qty !== ticket.qty || approval.limitPrice !== ticket.limitPrice || approval.session !== ticket.session) return "approval terms mismatch";
  if (approval.expiresAt !== ticket.expiresAt || approval.quoteTimestamp !== ticket.quoteTimestamp) return "approval quote or expiry mismatch";
  if (Date.parse(approval.expiresAt) <= now) return "approval expired";
  const expected = digest(secret, material(ticket));
  const a = Buffer.from(approval.proof);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return "approval proof mismatch";
  return null;
}

export function computeGates(ticket: PaperLimitTicket, broker: BrokerInputs): { ok: boolean; reason: string | null } {
  if (!broker.dataOk) return { ok: false, reason: "Sigma veto: data integrity" };
  if (!broker.accountActive || broker.tradingBlocked) return { ok: false, reason: "Sentinel veto: account" };
  if (ticket.side === "buy" && (broker.positions !== 0 || broker.openOrders !== 0)) return { ok: false, reason: "Sentinel veto: unexpected position or order" };
  if (ticket.side === "buy" && ticket.qty * ticket.limitPrice * 1.001 > 25) return { ok: false, reason: "Sentinel veto: notional" };
  if (!(ticket.bid > 0) || !(ticket.ask > ticket.bid) || ticket.quoteSpreadBps > 20) return { ok: false, reason: "Sentinel veto: quote" };
  return { ok: true, reason: null };
}

export function paperLimitPayload(ticket: PaperLimitTicket): Record<string, unknown> {
  return {
    symbol: ticket.symbol,
    side: ticket.side,
    type: "limit",
    qty: ticket.qty,
    time_in_force: "day",
    limit_price: ticket.limitPrice,
    client_order_id: ticket.clientOrderId,
  };
}

export function preparePaperLimit(
  ticket: PaperLimitTicket,
  journal: HermesJournal,
  broker: BrokerInputs,
  opts: { now?: number; approvalPath?: string } = {},
): PaperTransportResult {
  const fail = (reason: string, persisted = false): PaperTransportResult => ({
    enabled: false, submitted: false, host: "paper-api.alpaca.markets", clientOrderId: null, reason, intentPersisted: persisted, payload: null,
  });
  const now = opts.now ?? Date.now();
  if (!(ticket.qty > 0) || !(ticket.limitPrice > 0) || !Number.isFinite(ticket.qty) || !Number.isFinite(ticket.limitPrice)) return fail("quantity or limit invalid");
  const age = now - Date.parse(ticket.quoteTimestamp);
  if (!Number.isFinite(age) || age < 0 || age > 5_000) return fail("quote stale or future");
  const gates = computeGates(ticket, broker);
  if (!gates.ok) return fail(gates.reason!);
  const approval = opts.approvalPath ? loadOperatorApproval(opts.approvalPath) : null;
  const authErr = verifyOperatorApproval(ticket, approval, process.env.APEX_OPERATOR_SECRET ?? null, now);
  if (authErr) return fail(authErr);
  if (journal.isConsumed(ticket.clientOrderId)) return fail("duplicate client order id");
  assertPaperUrl(`${PAPER_TRADING_ORIGIN}/v2/orders`);
  const payload = paperLimitPayload(ticket);
  const intent: IntentRecord = {
    clientOrderId: ticket.clientOrderId,
    ticket: {
      category: "CONNECTIVITY_TEST",
      symbol: ticket.symbol,
      side: ticket.side,
      orderType: "limit",
      maxNotional: 25,
      expiry: ticket.expiresAt,
      singleUseId: ticket.clientOrderId,
      readAuthorized: true,
      orderAuthorized: true,
      confirmed: true,
    },
    createdAt: new Date(now).toISOString(),
    status: "PERSISTED",
    filledQty: 0,
    avgPrice: null,
    equityIdentity: {
      symbol: ticket.symbol,
      side: ticket.side,
      orderType: "limit",
      qty: ticket.qty,
      limitPrice: ticket.limitPrice,
      timeInForce: "day",
      session: ticket.session,
      extendedHours: false,
      singleUseId: ticket.clientOrderId,
      expiry: ticket.expiresAt,
      worstCaseNotional: ticket.qty * ticket.limitPrice * 1.001,
    },
  };
  journal.persist(intent);
  journal.consumeAuthorization(ticket.clientOrderId);
  if (PAPER_POST_ENABLED) {
    return fail("unreachable: PAPER post is hard-disabled", true);
  }
  return {
    enabled: false,
    submitted: false,
    host: "paper-api.alpaca.markets",
    clientOrderId: ticket.clientOrderId,
    reason: "PAPER POST disabled pending separate exact-ticket authorization. LIMIT intent persisted. No order submitted.",
    intentPersisted: true,
    payload,
  };
}

export function newClientOrderId(): string {
  return `apex-spy-${randomUUID()}`;
}
