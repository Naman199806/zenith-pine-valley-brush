/**
 * Versioned fill events for Hermes.
 * A broker event is emitted only from fields the broker reported.
 * Mock provenance is never broker evidence.
 */

import type { ExecutionOutcome } from "../../../src/lib/apex/research/hermes-outcomes.ts";

export const FILL_EVENT_VERSION = 1;

export type FillProvenance = "broker" | "mock";
export type FillVenue = "alpaca-paper" | "alpaca-live" | "mock";
export type FillSource = "MOCK" | "PAPER" | "LIVE";

export interface FillEvent {
  v: 1;
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
  provenance: FillProvenance;
}

const TEXT = ["decisionId", "strategyVersion", "clientOrderId", "symbol", "eventTimestamp"] as const;

export function validateFillEvent(event: FillEvent): string | null {
  if (!event || event.v !== FILL_EVENT_VERSION) return "unsupported fill event version";
  for (const field of TEXT) {
    if (typeof event[field] !== "string" || !event[field]) return `missing ${field}`;
  }
  if (event.side !== "buy" && event.side !== "sell") return "missing side";
  if (!Number.isFinite(event.qty) || !(event.qty > 0)) return "missing qty";
  if (!Number.isFinite(event.fillPrice) || !(event.fillPrice > 0)) return "missing fillPrice";
  if (!Number.isFinite(event.intendedPrice) || !(event.intendedPrice > 0)) return "missing intendedPrice";
  if (!Number.isFinite(event.fee) || event.fee < 0) return "missing fee";
  if (!Number.isFinite(Date.parse(event.eventTimestamp))) return "missing eventTimestamp";
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

export function fillEventFromBroker(input: {
  decisionId: string;
  strategyVersion: string;
  clientOrderId: string;
  symbol: string;
  side: "buy" | "sell";
  intendedPrice: number;
  previousFilled: number;
  body: unknown;
  provenance: FillProvenance;
  source: "PAPER" | "LIVE";
}): FillEvent | null {
  if (!input.body || typeof input.body !== "object") return null;
  const body = input.body as Record<string, unknown>;
  const observed = Number(body.filled_qty);
  if (!Number.isFinite(observed) || observed <= input.previousFilled + 1e-12) return null;
  const feeRaw = body.fee ?? body.commission;
  if (typeof body.filled_at !== "string" || feeRaw == null) return null;
  const mock = input.provenance === "mock";
  const event: FillEvent = {
    v: 1,
    decisionId: input.decisionId,
    strategyVersion: input.strategyVersion,
    clientOrderId: input.clientOrderId,
    brokerOrderId: mock ? null : typeof body.id === "string" ? body.id : null,
    fillId: mock ? null : typeof body.fill_id === "string" ? body.fill_id : typeof body.execution_id === "string" ? body.execution_id : null,
    symbol: input.symbol,
    side: input.side,
    qty: observed - input.previousFilled,
    fillPrice: Number(body.filled_avg_price),
    intendedPrice: input.intendedPrice,
    fee: Number(feeRaw),
    venue: mock ? "mock" : input.source === "LIVE" ? "alpaca-live" : "alpaca-paper",
    source: mock ? "MOCK" : input.source,
    eventTimestamp: body.filled_at,
    provenance: input.provenance,
  };
  if (validateFillEvent(event)) return null;
  return event;
}

export function trustedEvidenceFromFill(event: FillEvent): { clientOrderId: string; brokerOrderId: string; fillId: string; qty: number; fillPrice: number; source: "PAPER" | "LIVE" } | null {
  if (event.provenance !== "broker" || !event.brokerOrderId || !event.fillId || event.source === "MOCK") return null;
  return { clientOrderId: event.clientOrderId, brokerOrderId: event.brokerOrderId, fillId: event.fillId, qty: event.qty, fillPrice: event.fillPrice, source: event.source };
}
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
    at: event.eventTimestamp,
  };
}
