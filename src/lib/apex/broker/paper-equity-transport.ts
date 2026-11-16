/**
 * Isolated PAPER LIMIT adapter.
 * PAPER_POST_ENABLED is hard-false. This module verifies operator signatures.
 * It cannot issue them. Signing is scripts/operator-sign-ticket.mjs, run by the operator.
 * Authorization is not consumed while submission is disabled.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { PAPER_TRADING_ORIGIN, assertPaperUrl } from "./allowlist.ts";
import type { HermesJournal } from "../live/journal.ts";
import type { IntentRecord } from "../live/executor.ts";

export const PAPER_POST_ENABLED = false;
export const PAPER_STATES = ["PROPOSED", "AUTHORIZED", "SUBMISSION_ATTEMPTED", "BROKER_CONFIRMED", "UNKNOWN", "CLOSED"] as const;
export type PaperState = (typeof PAPER_STATES)[number];

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
  exitAuthorizationId: string | null;
}

export interface BrokerEvidence {
  fetchedAt: string;
  http: { account: number; clock: number; positions: number; openOrders: number; quote: number };
  accountActive: boolean;
  tradingBlocked: boolean;
  clockOpen: boolean;
  positions: { symbol: string; qty: number }[];
  openOrders: number;
  quote: { bid: number; ask: number; timestamp: string };
}

export interface OperatorApproval {
  source: "OPERATOR_SIGNED";
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
  state: PaperState;
  reason: string;
  intentPersisted: boolean;
  authorizationConsumed: false;
}

function digest(secret: string, material: string): string {
  return createHmac("sha256", secret).update(material).digest("hex");
}

function material(t: PaperLimitTicket): string {
  return [t.symbol, t.side, "limit", "day", String(t.qty), String(t.limitPrice), t.session, t.clientOrderId, t.expiresAt].join("|");
}

export function verifyOperatorApproval(ticket: PaperLimitTicket, approval: OperatorApproval | null, secret: string | null, now = Date.now()): string | null {
  if (!secret) return "operator secret not present; this process cannot mint approval";
  if (!approval || approval.source !== "OPERATOR_SIGNED") return "operator-signed approval required";
  if (approval.clientOrderId !== ticket.clientOrderId || approval.symbol !== ticket.symbol || approval.side !== ticket.side) return "approval identity mismatch";
  if (approval.qty !== ticket.qty || approval.limitPrice !== ticket.limitPrice || approval.session !== ticket.session) return "approval terms mismatch";
  if (approval.expiresAt !== ticket.expiresAt) return "approval expiry mismatch";
  if (Date.parse(approval.expiresAt) <= now) return "approval expired";
  const expected = digest(secret, material(ticket));
  const a = Buffer.from(approval.proof);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return "approval proof mismatch";
  return null;
}

export async function fetchPaperEvidence(
  get: (path: string) => Promise<{ status: number; body: unknown }>,
  now = new Date(),
): Promise<BrokerEvidence> {
  const account = await get("/v2/account");
  const clock = await get("/v2/clock");
  const positions = await get("/v2/positions");
  const open = await get("/v2/orders?status=open");
  const quote = await get("/v2/stocks/SPY/quotes/latest");
  const a = (account.body ?? {}) as { status?: string; trading_blocked?: boolean };
  const c = (clock.body ?? {}) as { is_open?: boolean };
  const q = ((quote.body ?? {}) as { quote?: { bp?: number; ap?: number; t?: string } }).quote ?? {};
  return {
    fetchedAt: now.toISOString(),
    http: { account: account.status, clock: clock.status, positions: positions.status, openOrders: open.status, quote: quote.status },
    accountActive: a.status === "ACTIVE",
    tradingBlocked: a.trading_blocked === true,
    clockOpen: c.is_open === true,
    positions: Array.isArray(positions.body) ? positions.body.map((p) => ({ symbol: String((p as { symbol?: string }).symbol ?? ""), qty: Number((p as { qty?: string }).qty) })) : (null as never),
    openOrders: Array.isArray(open.body) ? open.body.length : Number.NaN,
    quote: { bid: Number(q.bp), ask: Number(q.ap), timestamp: String(q.t ?? "") },
  };
}

export function validateEvidence(evidence: BrokerEvidence, now = Date.now()): string | null {
  const http = evidence.http;
  if (!http || [http.account, http.clock, http.positions, http.openOrders, http.quote].some((s) => s !== 200)) return "incomplete broker response";
  if (!Array.isArray(evidence.positions)) return "positions not an array";
  if (!evidence.accountActive || evidence.tradingBlocked || !evidence.clockOpen) return "account or session not eligible";
  const age = now - Date.parse(evidence.fetchedAt);
  const quoteAge = now - Date.parse(evidence.quote?.timestamp);
  if (!Number.isFinite(age) || age < 0 || age > 5_000) return "evidence stale or future";
  if (!Number.isFinite(quoteAge) || quoteAge < 0 || quoteAge > 5_000) return "quote stale or future";
  const { bid, ask } = evidence.quote;
  if (![bid, ask].every((n) => Number.isFinite(n) && n > 0) || ask <= bid) return "quote nonfinite";
  const spreadBps = (ask - bid) / ((ask + bid) / 2) * 10000;
  if (!Number.isFinite(spreadBps) || spreadBps > 20) return "spread above 20 bps";
  if (!Number.isFinite(evidence.openOrders) || evidence.openOrders < 0) return "open-order count invalid";
  if (evidence.positions.some((p) => !Number.isFinite(p.qty) || p.qty < 0)) return "position nonfinite";
  return null;
}

export function preparePaperLimit(
  ticket: PaperLimitTicket,
  journal: HermesJournal,
  evidence: BrokerEvidence,
  approval: OperatorApproval | null,
  opts: { now?: number } = {},
): PaperTransportResult {
  const fail = (reason: string, state: PaperState = "PROPOSED"): PaperTransportResult => ({
    enabled: false, submitted: false, host: "paper-api.alpaca.markets", clientOrderId: ticket.clientOrderId, state, reason, intentPersisted: false, authorizationConsumed: false,
  });
  const now = opts.now ?? Date.now();
  if (!(ticket.qty > 0) || !Number.isFinite(ticket.qty) || !(ticket.limitPrice > 0)) return fail("quantity or limit invalid");
  if (Date.parse(ticket.expiresAt) <= now) return fail("ticket expired");
  const evidenceErr = validateEvidence(evidence, now);
  if (evidenceErr) return fail(evidenceErr);
  if (ticket.side === "buy" && (evidence.positions.length !== 0 || evidence.openOrders !== 0)) return fail("mismatched broker state");
  if (ticket.side === "buy" && ticket.qty * ticket.limitPrice * 1.001 > 25) return fail("worst-case entry exceeds $25");
  if (ticket.side === "sell") {
    const owned = evidence.positions.find((p) => p.symbol === "SPY")?.qty ?? 0;
    if (!ticket.exitAuthorizationId) return fail("separate sell authorization required");
    if (!(owned > 0) || ticket.qty > owned) return fail("sell exceeds owned SPY quantity");
  }
  const authErr = verifyOperatorApproval(ticket, approval, process.env.APEX_OPERATOR_SECRET ?? null, now);
  const state: PaperState = authErr ? "PROPOSED" : "AUTHORIZED";
  if (journal.isConsumed(ticket.clientOrderId)) return fail("duplicate client order id", state);
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
      orderAuthorized: state === "AUTHORIZED",
      confirmed: false,
    },
    createdAt: new Date(now).toISOString(),
    status: "PERSISTED",
    filledQty: 0,
    avgPrice: null,
    paperState: state,
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
  return {
    enabled: false,
    submitted: false,
    host: "paper-api.alpaca.markets",
    clientOrderId: ticket.clientOrderId,
    state,
    reason: authErr ?? "AUTHORIZED but PAPER POST remains disabled. Authorization was not consumed.",
    intentPersisted: true,
    authorizationConsumed: false,
  };
}
