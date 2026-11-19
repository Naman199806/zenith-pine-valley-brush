/**
 * Fill evidence from Alpaca's documented payloads.
 * Order state uses filled_qty, filled_avg_price, and status.
 * Per-fill provenance uses account activities of type FILL.
 * The documented FILL object has no fee. A missing fee stays unknown.
 * Nothing here invents 0.
 *
 * - https://docs.alpaca.markets/us/reference/postorder
 * - https://docs.alpaca.markets/us/reference/getorderbyclientorderid
 * - https://docs.alpaca.markets/us/docs/account-activities
 * - https://docs.alpaca.markets/us/reference/getaccountactivitiesbyactivitytype-1
 */

import type { FillEvent } from "./fill-event.ts";

export const ALPACA_CREATE_ORDER_DOC = "https://docs.alpaca.markets/us/reference/postorder";
export const ALPACA_GET_BY_CLIENT_ORDER_ID_DOC = "https://docs.alpaca.markets/us/reference/getorderbyclientorderid";
export const ALPACA_LIST_ORDERS_DOC = "https://docs.alpaca.markets/us/reference/getallorders-1";
export const ALPACA_DELETE_ORDER_DOC = "https://docs.alpaca.markets/us/reference/deleteorderbyorderid-1";
export const ALPACA_ACTIVITIES_DOC = "https://docs.alpaca.markets/us/docs/account-activities";
export const ALPACA_ACTIVITIES_BY_TYPE_DOC = "https://docs.alpaca.markets/us/reference/getaccountactivitiesbyactivitytype-1";

export type EvidenceChannel = "alpaca-http" | "injected";

export interface AlpacaOrderView {
  id: string;
  clientOrderId: string;
  status: string;
  filledQty: number;
  filledAvgPrice: number | null;
  symbol: string;
  side: "buy" | "sell";
}

export function readAlpacaOrder(body: unknown): AlpacaOrderView | null {
  if (!body || typeof body !== "object") return null;
  const row = body as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.client_order_id !== "string" || typeof row.status !== "string") return null;
  if (typeof row.symbol !== "string" || (row.side !== "buy" && row.side !== "sell")) return null;
  const filledQty = Number(row.filled_qty);
  if (!Number.isFinite(filledQty) || filledQty < 0) return null;
  const avgRaw = row.filled_avg_price;
  const filledAvgPrice = avgRaw == null || avgRaw === "" ? null : Number(avgRaw);
  if (filledAvgPrice != null && (!Number.isFinite(filledAvgPrice) || filledAvgPrice <= 0)) return null;
  return { id: row.id, clientOrderId: row.client_order_id, status: row.status, filledQty, filledAvgPrice, symbol: row.symbol, side: row.side };
}

/** A present numeric fee, including 0. A missing field stays unknown. A blank or non-numeric field is not a zero. */
function knownFee(row: Record<string, unknown>): number | null {
  const named = Object.prototype.hasOwnProperty.call(row, "fee") || Object.prototype.hasOwnProperty.call(row, "commission");
  if (!named) return null;
  const raw = row.fee ?? row.commission;
  if (typeof raw === "string" && raw.trim() === "") return null;
  if (typeof raw !== "number" && typeof raw !== "string") return null;
  const fee = Number(raw);
  if (!Number.isFinite(fee) || fee < 0) return null;
  return fee;
}

/**
 * One documented FILL activity is one fill.
 * fee stays null unless that activity itself carries a numeric fee or commission.
 */
export function fillsFromActivities(input: {
  decisionId: string;
  strategyVersion: string;
  clientOrderId: string;
  symbol: string;
  side: "buy" | "sell";
  intendedPrice: number;
  activities: unknown;
  evidenceChannel: EvidenceChannel;
  seenFillIds?: string[];
}): { events: FillEvent[]; incompleteReason: string | null } {
  if (!Array.isArray(input.activities)) return { events: [], incompleteReason: "FILL activities unavailable" };
  const seen = new Set(input.seenFillIds ?? []);
  const events: FillEvent[] = [];
  for (const raw of input.activities) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    if (row.activity_type !== "FILL") continue;
    if (row.symbol !== input.symbol || (row.side !== "buy" && row.side !== "sell")) continue;
    const fillId = typeof row.id === "string" ? row.id : "";
    const brokerOrderId = typeof row.order_id === "string" ? row.order_id : "";
    const qty = Number(row.qty);
    const fillPrice = Number(row.price);
    const when = typeof row.transaction_time === "string" ? row.transaction_time : "";
    if (!fillId || !brokerOrderId || !(qty > 0) || !(fillPrice > 0) || !Number.isFinite(Date.parse(when))) continue;
    if (seen.has(fillId)) continue;
    const fee = knownFee(row);
    const injected = input.evidenceChannel === "injected";
    const feeKnown = fee != null;
    events.push({
      v: 1,
      status: "COMPLETE",
      decisionId: input.decisionId,
      strategyVersion: input.strategyVersion,
      clientOrderId: input.clientOrderId,
      brokerOrderId,
      fillId,
      symbol: input.symbol,
      side: row.side,
      qty,
      fillPrice,
      intendedPrice: input.intendedPrice,
      fee,
      feeKnown,
      feeSource: feeKnown ? "broker" : "unknown",
      netPnlAttributable: feeKnown && !injected,
      category: "SUPERVISED_PAPER_TEST",
      venue: injected ? "mock" : "alpaca-paper",
      source: injected ? "MOCK" : "PAPER",
      eventTimestamp: when,
      at: when,
      provenance: injected ? "injected" : "broker",
      evidenceChannel: input.evidenceChannel,
    });
    seen.add(fillId);
  }
  return { events, incompleteReason: events.length ? null : "no FILL activity for this order" };
}
