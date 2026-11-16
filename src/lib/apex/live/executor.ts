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
  equityIdentity?: {
    symbol: string;
    side: "buy" | "sell";
    orderType: "market" | "limit";
    qty: number;
    limitPrice: number | null;
    timeInForce: "day" | "gtc" | "ioc";
    session: string;
    extendedHours: boolean;
    singleUseId: string;
    expiry: string;
    worstCaseNotional: number;
  };
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
const MAX_QUOTE_AGE_MS = 15_000;

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

export function checkQuoteFreshness(quote: Quote, now = Date.now()): string | null {
  const ts = Date.parse(quote.timestamp);
  if (!Number.isFinite(ts)) return "quote timestamp missing or invalid";
  const age = now - ts;
  if (age < 0) return "quote timestamp in the future";
  if (age > MAX_QUOTE_AGE_MS) return `quote stale (${age} ms > ${MAX_QUOTE_AGE_MS})`;
  return null;
}

export function checkSpread(quote: Quote, maxBps = MAX_SPREAD_BPS): string | null {
  if (!(quote.bid > 0 && quote.ask > quote.bid)) return "invalid quote";
  const mid = (quote.bid + quote.ask) / 2;
  const spreadBps = ((quote.ask - quote.bid) / mid) * 10000;
  if (spreadBps > maxBps) return `spread ${spreadBps.toFixed(1)} bps exceeds ${maxBps}`;
  return null;
}

export interface GateResult {
  sigmaVeto: boolean;
  sentinelVeto: boolean;
  sigmaApproved: boolean;
  sentinelApproved: boolean;
  reason: string | null;
}

export function evaluateGates(opts: { dataIntegrityOk: boolean; riskOk: boolean; notional: number }): GateResult {
  if (!opts.dataIntegrityOk) return { sigmaVeto: true, sentinelVeto: false, sigmaApproved: false, sentinelApproved: false, reason: "Sigma veto: data integrity failure" };
  if (!opts.riskOk || opts.notional > HARD_MAX) return { sigmaVeto: false, sentinelVeto: true, sigmaApproved: false, sentinelApproved: false, reason: "Sentinel veto: risk or exposure limit" };
  return { sigmaVeto: false, sentinelVeto: false, sigmaApproved: true, sentinelApproved: true, reason: null };
}

export interface GateProof {
  singleUseId: string;
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  limitPrice: number | null;
  computedAt: string;
  sigmaApproved: boolean;
  sentinelApproved: boolean;
  sigmaVeto: boolean;
  sentinelVeto: boolean;
  proof: string;
}

import { createHmac, timingSafeEqual } from "node:crypto";

function proofMaterial(p: Omit<GateProof, "proof">): string {
  return [p.singleUseId, p.symbol, p.side, String(p.qty), String(p.limitPrice), p.computedAt, String(p.sigmaApproved), String(p.sentinelApproved), String(p.sigmaVeto), String(p.sentinelVeto)].join("|");
}

function hmac(secret: string, material: string): string {
  return createHmac("sha256", secret).update(material).digest("hex");
}

export function issueGateProof(
  bind: { singleUseId: string; symbol: string; side: "buy" | "sell"; qty: number; limitPrice: number | null },
  opts: { dataIntegrityOk: boolean; riskOk: boolean; notional: number },
  now = new Date(),
  secret: string | null = process.env.APEX_GATE_SECRET ?? null,
): GateProof | null {
  if (!secret || secret.length < 32) return null;
  const sigma = !opts.dataIntegrityOk
    ? { sigmaVeto: true, sigmaApproved: false }
    : { sigmaVeto: false, sigmaApproved: true };
  const sentinel = !opts.riskOk || opts.notional > HARD_MAX
    ? { sentinelVeto: true, sentinelApproved: false }
    : { sentinelVeto: false, sentinelApproved: true };
  const base = {
    singleUseId: bind.singleUseId,
    symbol: bind.symbol,
    side: bind.side,
    qty: bind.qty,
    limitPrice: bind.limitPrice,
    computedAt: now.toISOString(),
    ...sigma,
    ...sentinel,
  };
  return { ...base, proof: hmac(secret, proofMaterial(base)) };
}

export function verifyGateProof(
  proof: GateProof | null,
  bind: { singleUseId: string; symbol: string; side: "buy" | "sell"; qty: number; limitPrice: number | null },
  now = Date.now(),
  maxAgeMs = 30_000,
  secret: string | null = process.env.APEX_GATE_SECRET ?? null,
): string | null {
  if (!secret || secret.length < 32) return "gate issuer secret missing; fail closed";
  if (!proof) return "missing ticket-bound gate proof";
  const expected = hmac(secret, proofMaterial({ ...proof }));
  const a = Buffer.from(proof.proof);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return "gate proof was not issued by Sigma/Sentinel";
  if (proof.singleUseId !== bind.singleUseId || proof.symbol !== bind.symbol || proof.side !== bind.side) return "gate proof not bound to ticket";
  if (proof.qty !== bind.qty || proof.limitPrice !== bind.limitPrice) return "gate proof quantity or price mismatch";
  const age = now - Date.parse(proof.computedAt);
  if (!Number.isFinite(age) || age < 0 || age > maxAgeMs) return "gate proof stale or future";
  if (proof.sigmaVeto || !proof.sigmaApproved) return "Sigma approval missing or vetoed";
  if (proof.sentinelVeto || !proof.sentinelApproved) return "Sentinel approval missing or vetoed";
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
  gates: GateResult | null = null,
): ExecutorResult {
  const err = validateTicket(auth);
  if (err) {
    return { enabled: false, submitted: false, clientOrderId: null, reason: err, intent: null };
  }
  if (emergencyEntryBlock && auth.side === "buy") {
    return { enabled: false, submitted: false, clientOrderId: null, reason: "emergency entry block active; risk-reducing exit remains possible under separate authorization", intent: null };
  }
  if (auth.side === "buy") {
    if (!gates || gates.sigmaVeto || gates.sentinelVeto || !gates.sigmaApproved || !gates.sentinelApproved) {
      return { enabled: false, submitted: false, clientOrderId: null, reason: gates?.reason || "missing Sigma or Sentinel approval; entry blocked", intent: null };
    }
  } else if (gates && (gates.sigmaVeto || gates.sentinelVeto)) {
    return { enabled: false, submitted: false, clientOrderId: null, reason: gates.reason || "gate veto", intent: null };
  }
  const freshErr = checkQuoteFreshness(quote);
  if (freshErr) {
    return { enabled: false, submitted: false, clientOrderId: null, reason: freshErr, intent: null };
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
