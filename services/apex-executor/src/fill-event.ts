/**
 * Versioned fill events for Hermes.
 * Each event is one execution, at that execution's own price.
 * Cumulative filled_avg_price is not an execution price.
 * Missing execution fields stay INCOMPLETE. Mock provenance is not broker evidence.
 */

import type { ExecutionOutcome, TrustedEvidence } from "../../../src/lib/apex/research/hermes-outcomes.ts";

export const FILL_EVENT_VERSION = 1;

export type FillProvenance = "broker" | "mock";
export type FillVenue = "alpaca-paper" | "alpaca-live" | "mock";
export type FillSource = "MOCK" | "PAPER" | "LIVE";

export interface FillEvent {
  v: 1;
  status: "COMPLETE";
  decisionId: string;
  strategyVersion: string;
  clientOrderId: string;
  brokerOrderId: string | null;
  fillId: string | null;
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  fillPrice: number;
  intendedPrice: number;
  fee: number;
  venue: FillVenue;
  source: FillSource;
  eventTimestamp: string;
  at: string;
  provenance: FillProvenance;
}

export interface IncompleteFill {
  v: 1;
  status: "INCOMPLETE";
  decisionId: string;
  strategyVersion: string;
  clientOrderId: string;
  symbol: string;
  side: "buy" | "sell";
  reason: string;
  provenance: FillProvenance;
  at: string;
}

export interface FillExtraction {
  events: FillEvent[];
  incomplete: IncompleteFill[];
}

const TEXT = ["decisionId", "strategyVersion", "clientOrderId", "symbol", "eventTimestamp", "at"] as const;

export function validateFillEvent(event: FillEvent): string | null {
  if (!event || event.v !== FILL_EVENT_VERSION) return "unsupported fill event version";
  if (event.status !== "COMPLETE") return "incomplete fill";
  for (const field of TEXT) {
    if (typeof event[field] !== "string" || !event[field]) return `missing ${field}`;
  }
  if (event.at !== event.eventTimestamp) return "missing at";
  if (event.side !== "buy" && event.side !== "sell") return "missing side";
  if (!Number.isFinite(event.qty) || !(event.qty > 0)) return "missing qty";
  if (!Number.isFinite(event.fillPrice) || !(event.fillPrice > 0)) return "missing fillPrice";
  if (!Number.isFinite(event.intendedPrice) || !(event.intendedPrice > 0)) return "missing intendedPrice";
  if (!Number.isFinite(event.fee) || event.fee < 0) return "missing fee";
  if (!Number.isFinite(Date.parse(event.at))) return "missing at";
  if (event.provenance === "mock") {
    if (event.source !== "MOCK" || event.venue !== "mock") return "mock provenance cannot be broker evidence";
    return null;
  }
  if (event.provenance !== "broker") return "missing provenance";
  if (event.source !== "PAPER" && event.source !== "LIVE") return "broker provenance requires PAPER or LIVE source";
  if (event.venue !== (event.source === "LIVE" ? "alpaca-live" : "alpaca-paper")) return "venue does not match source";
  if (!event.brokerOrderId || !event.fillId) return "missing brokerOrderId or fillId";
  return null;
}

function executionsOf(body: unknown): unknown[] | null {
  if (!body || typeof body !== "object") return null;
  const row = body as Record<string, unknown>;
  const list = row.executions ?? row.activities ?? row.fills;
  return Array.isArray(list) ? list : null;
}

function incomplete(input: {
  decisionId: string;
  strategyVersion: string;
  clientOrderId: string;
  symbol: string;
  side: "buy" | "sell";
  reason: string;
  provenance: FillProvenance;
  at: string;
}): IncompleteFill {
  return { v: 1, status: "INCOMPLETE", ...input };
}

/**
 * One Alpaca FILL activity (or trade_update execution) is one incremental fill.
 * filled_avg_price on the parent order is ignored.
 */
export function fillsFromExecutions(input: {
  decisionId: string;
  strategyVersion: string;
  clientOrderId: string;
  symbol: string;
  side: "buy" | "sell";
  intendedPrice: number;
  body: unknown;
  provenance: FillProvenance;
  source: "PAPER" | "LIVE";
  seenFillIds?: string[];
}): FillExtraction {
  const at = new Date().toISOString();
  const base = {
    decisionId: input.decisionId,
    strategyVersion: input.strategyVersion,
    clientOrderId: input.clientOrderId,
    symbol: input.symbol,
    side: input.side,
    provenance: input.provenance,
    at,
  };
  const list = executionsOf(input.body);
  if (!list) {
    return { events: [], incomplete: [incomplete({ ...base, reason: "execution-level fill records unavailable" })] };
  }
  const seen = new Set(input.seenFillIds ?? []);
  const events: FillEvent[] = [];
  const gaps: IncompleteFill[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") {
      gaps.push(incomplete({ ...base, reason: "execution record is not an object" }));
      continue;
    }
    const row = raw as Record<string, unknown>;
    const fillId = typeof row.id === "string" ? row.id : typeof row.fill_id === "string" ? row.fill_id : "";
    if (fillId && seen.has(fillId)) continue;
    const brokerOrderId = typeof row.order_id === "string" ? row.order_id : typeof row.orderId === "string" ? row.orderId : "";
    const qty = Number(row.qty);
    const fillPrice = Number(row.price);
    const when = typeof row.transaction_time === "string" ? row.transaction_time : typeof row.timestamp === "string" ? row.timestamp : "";
    const feeRaw = row.fee ?? row.commission;
    const missing: string[] = [];
    if (!fillId) missing.push("fillId");
    if (!brokerOrderId) missing.push("brokerOrderId");
    if (!Number.isFinite(qty) || !(qty > 0)) missing.push("qty");
    if (!Number.isFinite(fillPrice) || !(fillPrice > 0)) missing.push("fillPrice");
    if (!when || !Number.isFinite(Date.parse(when))) missing.push("eventTimestamp");
    if (feeRaw == null || !Number.isFinite(Number(feeRaw)) || Number(feeRaw) < 0) missing.push("fee");
    if (!Number.isFinite(input.intendedPrice) || !(input.intendedPrice > 0)) missing.push("intendedPrice");
    if (missing.length) {
      gaps.push(incomplete({ ...base, at: when || at, reason: `missing ${missing.join(", ")}` }));
      continue;
    }
    const mock = input.provenance === "mock";
    const event: FillEvent = {
      v: 1,
      status: "COMPLETE",
      decisionId: input.decisionId,
      strategyVersion: input.strategyVersion,
      clientOrderId: input.clientOrderId,
      brokerOrderId,
      fillId,
      symbol: input.symbol,
      side: input.side,
      qty,
      fillPrice,
      intendedPrice: input.intendedPrice,
      fee: Number(feeRaw),
      venue: mock ? "mock" : input.source === "LIVE" ? "alpaca-live" : "alpaca-paper",
      source: mock ? "MOCK" : input.source,
      eventTimestamp: when,
      at: when,
      provenance: input.provenance,
    };
    const err = validateFillEvent(event);
    if (err) {
      gaps.push(incomplete({ ...base, at: when, reason: err }));
      continue;
    }
    if (fillId) seen.add(fillId);
    events.push(event);
  }
  return { events, incomplete: gaps };
}

export function toResearchOutcome(event: FillEvent): ExecutionOutcome {
  const broker = event.provenance === "broker";
  return {
    decisionId: event.decisionId,
    strategyVersion: event.strategyVersion,
    clientOrderId: event.clientOrderId,
    symbol: event.symbol,
    side: event.side,
    qty: event.qty,
    fillPrice: event.fillPrice,
    intendedPrice: event.intendedPrice,
    fee: event.fee,
    source: event.source,
    brokerOrderId: broker ? event.brokerOrderId : null,
    fillId: broker ? event.fillId : null,
    corrected: false,
    at: event.at,
  };
}

export function trustedEvidence(events: FillEvent[]): TrustedEvidence[] {
  return events.filter((event) => event.provenance === "broker" && event.status === "COMPLETE" && (event.source === "PAPER" || event.source === "LIVE") && event.brokerOrderId && event.fillId).map((event) => ({
    clientOrderId: event.clientOrderId,
    brokerOrderId: event.brokerOrderId as string,
    fillId: event.fillId as string,
    qty: event.qty,
    fillPrice: event.fillPrice,
    source: event.source as "PAPER" | "LIVE",
  }));
}
