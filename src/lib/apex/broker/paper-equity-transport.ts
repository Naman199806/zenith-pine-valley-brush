/**
 * Isolated PAPER equity LIMIT transport.
 * Disabled. Production cannot submit, even if a caller injects a POST callback.
 * Authorization and Sigma/Sentinel proofs are independently verified and ticket-bound.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { PAPER_TRADING_ORIGIN, assertPaperUrl } from "./allowlist.ts";
import type { HermesJournal } from "../live/journal.ts";
import type { IntentRecord, GateProof } from "../live/executor.ts";
import { verifyGateProof } from "../live/executor.ts";

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
  exitAuthorizationId: string | null;
}

export interface PaperTransportResult {
  enabled: false;
  submitted: false;
  host: "paper-api.alpaca.markets";
  clientOrderId: string | null;
  reason: string;
  intentPersisted: boolean;
}

function digest(secret: string, material: string): string {
  return createHmac("sha256", secret).update(material).digest("hex");
}

export function issueOperatorAuth(ticket: PaperLimitTicket, secret: string, now = new Date()): { clientOrderId: string; expiresAt: string; proof: string } | null {
  if (!secret || secret.length < 32) return null;
  const material = [ticket.symbol, ticket.side, ticket.orderType, ticket.timeInForce, String(ticket.qty), String(ticket.limitPrice), ticket.session, ticket.clientOrderId, ticket.expiresAt].join("|");
  return { clientOrderId: ticket.clientOrderId, expiresAt: ticket.expiresAt, proof: digest(secret, material) };
}

export function verifyOperatorAuth(ticket: PaperLimitTicket, auth: { clientOrderId: string; expiresAt: string; proof: string } | null, secret: string | null, now = Date.now()): string | null {
  if (!secret || secret.length < 32) return "operator auth secret missing";
  if (!auth) return "missing operator authorization";
  const material = [ticket.symbol, ticket.side, ticket.orderType, ticket.timeInForce, String(ticket.qty), String(ticket.limitPrice), ticket.session, ticket.clientOrderId, ticket.expiresAt].join("|");
  const expected = digest(secret, material);
  const a = Buffer.from(auth.proof);
  const b = Buffer.from(expected);
  if (auth.clientOrderId !== ticket.clientOrderId || auth.expiresAt !== ticket.expiresAt) return "authorization not bound to ticket";
  if (a.length !== b.length || !timingSafeEqual(a, b)) return "authorization proof mismatch";
  if (Date.parse(auth.expiresAt) <= now) return "authorization expired";
  return null;
}

export function validatePaperLimit(t: PaperLimitTicket, now = Date.now()): string | null {
  if (t.symbol !== "SPY") return "only SPY";
  if (t.orderType !== "limit" || t.timeInForce !== "day" || t.session !== "REGULAR") return "limit day regular required";
  if (!(t.qty > 0) || !Number.isFinite(t.qty) || !(t.limitPrice > 0) || !Number.isFinite(t.limitPrice)) return "quantity and limit must be positive and finite";
  if (t.side === "buy" && t.qty * t.limitPrice * 1.001 > 25) return "worst-case entry exceeds $25";
  if (Date.parse(t.expiresAt) <= now) return "authorization expired";
  const age = now - Date.parse(t.quoteTimestamp);
  if (!Number.isFinite(age) || age < 0 || age > 5_000) return "quote stale";
  if (!(t.quoteSpreadBps >= 0) || t.quoteSpreadBps > 20) return "spread gate";
  if (t.side === "sell" && !t.exitAuthorizationId) return "independent exit authorization required";
  if (!t.clientOrderId) return "unique client order id required";
  return null;
}

export function preparePaperLimit(
  ticket: PaperLimitTicket,
  journal: HermesJournal,
  auth: { clientOrderId: string; expiresAt: string; proof: string } | null,
  proof: GateProof | null,
  opts: { now?: number; authSecret?: string | null; gateSecret?: string | null } = {},
): PaperTransportResult {
  const fail = (reason: string, persisted = false): PaperTransportResult => ({
    enabled: false, submitted: false, host: "paper-api.alpaca.markets", clientOrderId: null, reason, intentPersisted: persisted,
  });
  const now = opts.now ?? Date.now();
  const err = validatePaperLimit(ticket, now);
  if (err) return fail(err);
  const authErr = verifyOperatorAuth(ticket, auth, opts.authSecret ?? null, now);
  if (authErr) return fail(authErr);
  const gateErr = verifyGateProof(proof, { singleUseId: ticket.clientOrderId, symbol: ticket.symbol, side: ticket.side, qty: ticket.qty, limitPrice: ticket.limitPrice }, now, 30_000, opts.gateSecret ?? null);
  if (gateErr) return fail(gateErr);
  if (journal.isConsumed(ticket.clientOrderId)) return fail("duplicate client order id");
  assertPaperUrl(`${PAPER_TRADING_ORIGIN}/v2/orders`);
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
      timeInForce: ticket.timeInForce,
      session: ticket.session,
      extendedHours: false,
      singleUseId: ticket.clientOrderId,
      expiry: ticket.expiresAt,
      worstCaseNotional: ticket.qty * ticket.limitPrice * 1.001,
    },
  };
  journal.persist(intent);
  journal.consumeAuthorization(ticket.clientOrderId);
  return {
    enabled: false,
    submitted: false,
    host: "paper-api.alpaca.markets",
    clientOrderId: ticket.clientOrderId,
    reason: "PAPER transport disabled. Intent persisted with LIMIT fields. No order submitted.",
    intentPersisted: true,
  };
}
