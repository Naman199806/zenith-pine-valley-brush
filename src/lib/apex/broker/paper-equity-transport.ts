/**
 * Isolated PAPER equity LIMIT transport.
 * Disabled by default. Exact paper host only. Never selects LIVE.
 * Production path does not submit. Tests may inject a mock transport.
 */

import { PAPER_TRADING_ORIGIN, assertPaperUrl } from "./allowlist.ts";
import type { HermesJournal } from "../live/journal.ts";
import type { IntentRecord } from "../live/executor.ts";

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
  operatorAuthorized: boolean;
  sigmaApproved: boolean;
  sentinelApproved: boolean;
  quoteTimestamp: string;
  quoteSpreadBps: number;
  exitAuthorizationId: string | null;
}

export interface PaperTransportResult {
  enabled: boolean;
  submitted: boolean;
  host: "paper-api.alpaca.markets";
  clientOrderId: string | null;
  reason: string;
  intentPersisted: boolean;
}

export function validatePaperLimit(t: PaperLimitTicket, now = Date.now()): string | null {
  if (t.symbol !== "SPY") return "only SPY";
  if (t.orderType !== "limit" || t.timeInForce !== "day" || t.session !== "REGULAR") return "limit day regular required";
  if (!(t.qty > 0) || !(t.limitPrice > 0)) return "quantity and limit must be positive";
  if (t.side === "buy" && t.qty * t.limitPrice * 1.001 > 25) return "worst-case entry exceeds $25";
  if (!t.operatorAuthorized) return "exact operator authorization required";
  if (!t.sigmaApproved || !t.sentinelApproved) return "Sigma and Sentinel required";
  if (Date.parse(t.expiresAt) <= now) return "authorization expired";
  const age = now - Date.parse(t.quoteTimestamp);
  if (!Number.isFinite(age) || age < 0 || age > 5_000) return "quote stale";
  if (!(t.quoteSpreadBps >= 0) || t.quoteSpreadBps > 20) return "spread gate";
  if (t.side === "sell" && !t.exitAuthorizationId) return "independent exit authorization required";
  if (!t.clientOrderId) return "unique client order id required";
  return null;
}

export async function preparePaperLimit(
  ticket: PaperLimitTicket,
  journal: HermesJournal,
  opts: { enabled?: boolean; transport?: { post: (body: unknown) => Promise<{ status: number }> }; now?: number } = {},
): Promise<PaperTransportResult> {
  const fail = (reason: string, persisted = false): PaperTransportResult => ({
    enabled: false, submitted: false, host: "paper-api.alpaca.markets", clientOrderId: null, reason, intentPersisted: persisted,
  });
  const err = validatePaperLimit(ticket, opts.now ?? Date.now());
  if (err) return fail(err);
  if (journal.isConsumed(ticket.clientOrderId)) return fail("duplicate client order id");
  assertPaperUrl(`${PAPER_TRADING_ORIGIN}/v2/orders`);
  const intent: IntentRecord = {
    clientOrderId: ticket.clientOrderId,
    ticket: {
      category: "CONNECTIVITY_TEST",
      symbol: ticket.symbol,
      side: ticket.side,
      orderType: "market",
      maxNotional: 25,
      expiry: ticket.expiresAt,
      singleUseId: ticket.clientOrderId,
      readAuthorized: true,
      orderAuthorized: ticket.operatorAuthorized,
      confirmed: true,
    },
    createdAt: new Date(opts.now ?? Date.now()).toISOString(),
    status: "PERSISTED",
    filledQty: 0,
    avgPrice: null,
  };
  journal.persist(intent);
  journal.consumeAuthorization(ticket.clientOrderId);
  if (!opts.enabled || !opts.transport) {
    return { enabled: false, submitted: false, host: "paper-api.alpaca.markets", clientOrderId: ticket.clientOrderId, reason: "PAPER transport disabled by default. Intent persisted. No order submitted.", intentPersisted: true };
  }
  try {
    const res = await opts.transport.post({ symbol: ticket.symbol, qty: ticket.qty, side: ticket.side, type: "limit", time_in_force: "day", limit_price: ticket.limitPrice, client_order_id: ticket.clientOrderId });
    return { enabled: true, submitted: res.status >= 200 && res.status < 300, host: "paper-api.alpaca.markets", clientOrderId: ticket.clientOrderId, reason: "mock transport only", intentPersisted: true };
  } catch {
    return { enabled: true, submitted: false, host: "paper-api.alpaca.markets", clientOrderId: ticket.clientOrderId, reason: "unknown outcome; not resubmitted", intentPersisted: true };
  }
}
