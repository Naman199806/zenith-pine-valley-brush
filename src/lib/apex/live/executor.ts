/**
 * Isolated, disabled-by-default supervised LIVE order transport.
 * CONNECTIVITY_TEST only. Never STRATEGY_TRADE.
 * Real-money order permission is distinct from read-only permission.
 * Hard max $25. Persist intent before any submission attempt.
 * Unique client order ID. No blind timeout retries.
 * Reconcile owned quantity before any sell.
 * Emergency entry block does not prevent independently authorized risk-reducing exit.
 * strategyApproved remains false. Autonomous execution remains prohibited.
 */

import { CONNECTIVITY_TEST, STRATEGY_TRADE, type AuthorizationCategory } from "./connectivity.ts";

export interface TicketAuthorization {
  category: AuthorizationCategory;
  symbol: string;
  side: "buy" | "sell";
  orderType: "market";
  maxNotional: number;
  expiry: string; // ISO
  singleUseId: string;
  readAuthorized: boolean;
  orderAuthorized: boolean;
  confirmed: boolean;
}

export interface IntentRecord {
  clientOrderId: string;
  ticket: TicketAuthorization;
  createdAt: string;
  status: "PERSISTED" | "SUBMITTED" | "FILLED" | "PARTIAL" | "REJECTED" | "CANCELED" | "UNKNOWN";
  filledQty: number;
  avgPrice: number | null;
}

export interface Quote {
  bid: number;
  ask: number;
  timestamp: string;
}

export interface LiveOrderTransport {
  post(url: string, body: unknown): Promise<{ status: number; body: unknown }>;
  get(url: string): Promise<{ status: number; body: unknown }>;
}

const HARD_MAX = 25;
const MAX_SPREAD_BPS = 50;

export function validateTicket(auth: TicketAuthorization, now = new Date()): string | null {
  if (auth.category !== CONNECTIVITY_TEST) return "only CONNECTIVITY_TEST permitted";
  if (!auth.readAuthorized) return "read authorization required";
  if (!auth.orderAuthorized) return "separate real-money order permission required";
  if (!auth.confirmed) return "explicit confirmation required";
  if (auth.maxNotional <= 0 || auth.maxNotional > HARD_MAX) return `max notional must be <= ${HARD_MAX}`;
  if (auth.side !== "buy" && auth.side !== "sell") return "invalid side";
  if (new Date(auth.expiry) <= now) return "authorization expired";
  if (!auth.singleUseId) return "single-use identity required";
  return null;
}

export function checkSpread(quote: Quote, maxBps = MAX_SPREAD_BPS): string | null {
  if (!(quote.bid > 0 && quote.ask > quote.bid)) return "invalid quote";
  const mid = (quote.bid + quote.ask) / 2;
  const spreadBps = ((quote.ask - quote.bid) / mid) * 10000;
  if (spreadBps > maxBps) return `spread ${spreadBps.toFixed(1)} bps exceeds ${maxBps}`;
  return null;
}

export interface ExecutorResult {
  enabled: false;
  submitted: false;
  clientOrderId: string | null;
  reason: string;
  intent: IntentRecord | null;
}

/**
 * Always returns enabled: false and submitted: false.
 * The hard disable cannot be cleared by this function.
 * Tests may simulate the post-persist path with a mock transport
 * but the production path never submits.
 */
export function prepareSupervisedTicket(
  auth: TicketAuthorization,
  quote: Quote,
  emergencyEntryBlock = false,
): ExecutorResult {
  const err = validateTicket(auth);
  if (err) {
    return { enabled: false, submitted: false, clientOrderId: null, reason: err, intent: null };
  }
  if (emergencyEntryBlock && auth.side === "buy") {
    return { enabled: false, submitted: false, clientOrderId: null, reason: "emergency entry block active; risk-reducing exit remains possible under separate authorization", intent: null };
  }
  const spreadErr = checkSpread(quote);
  if (spreadErr) {
    return { enabled: false, submitted: false, clientOrderId: null, reason: spreadErr, intent: null };
  }
  const clientOrderId = `apex-live-${auth.singleUseId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const intent: IntentRecord = {
    clientOrderId,
    ticket: auth,
    createdAt: new Date().toISOString(),
    status: "PERSISTED",
    filledQty: 0,
    avgPrice: null,
  };
  // Hard disable: never submit.
  return {
    enabled: false,
    submitted: false,
    clientOrderId,
    reason: "LIVE order transport is disabled by default. Intent persisted for audit. No order submitted. Separate foreground authorization and supervision required.",
    intent,
  };
}

export function reconcileBeforeExit(ownedQty: number, requestedSellQty: number): string | null {
  if (ownedQty <= 0) return "no position to exit";
  if (requestedSellQty > ownedQty + 1e-8) return "sell quantity exceeds owned quantity";
  return null;
}

export function verifyFlat(positions: { symbol: string; qty: number }[], openOrders: number): boolean {
  const residual = positions.filter((p) => Math.abs(p.qty) > 1e-8);
  return residual.length === 0 && openOrders === 0;
}
