import { assertPaperUrl, DATA_ORIGIN, PAPER_TRADING_ORIGIN, redactSecrets } from "./allowlist.ts";
import { isTerminal, mapBrokerStatus, transition, type BrokerOrderState } from "./machine.ts";
import { maySubmit, type LaunchMode } from "./launch.ts";
import { sizePaperOrder } from "./risk-paper.ts";

export interface Transport {
  call(input: { method: string; url: string; body?: unknown; headers: Record<string, string> }): Promise<{ status: number; body: unknown }>;
}

export interface Credentials {
  keyId: string;
  secret: string;
}

export interface BrokerOrder {
  clientOrderId: string;
  brokerId: string | null;
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  filledQty: number;
  state: BrokerOrderState;
  reason: string;
  theoretical: boolean;
}

export interface EntryRequest {
  symbol: string;
  side: "buy" | "sell";
  entryPriceCents: number;
  stopPriceCents: number;
  equityCents: number;
  cashCents: number;
  openPositions: number;
  entriesToday: number;
  dayDrawdown: number;
  minuteEt: number;
  dataOk: boolean;
  emergency: boolean;
  duplicate: boolean;
  closing: boolean;
  closeQty: number;
  mode: LaunchMode;
  operatorConfirmed: boolean;
  autoApproved: boolean;
  blockOrders: boolean;
}

function headers(creds: Credentials): Record<string, string> {
  return { "APCA-API-KEY-ID": creds.keyId, "APCA-API-SECRET-KEY": creds.secret };
}

function clientOrderId(symbol: string, nowIso: string, salt: string): string {
  const compact = nowIso.replace(/[-:TZ.]/g, "").slice(0, 14);
  const id = `ax${compact}${symbol}${salt}`.replace(/[^A-Za-z0-9]/g, "").slice(0, 48);
  return id;
}

async function lookup(transport: Transport, creds: Credentials, clientId: string): Promise<{ status: number; body: unknown }> {
  const url = `${PAPER_TRADING_ORIGIN}/v2/orders:by_client_order_id?client_order_id=${encodeURIComponent(clientId)}`;
  assertPaperUrl(url);
  return transport.call({ method: "GET", url, headers: headers(creds) });
}

export async function executePaperEntry(transport: Transport, creds: Credentials, input: EntryRequest, nowIso: string, salt: string): Promise<BrokerOrder> {
  const id = clientOrderId(input.symbol, nowIso, salt);
  const blocked = maySubmit(input.mode, input.operatorConfirmed, input.autoApproved);
  const base: BrokerOrder = {
    clientOrderId: id,
    brokerId: null,
    symbol: input.symbol,
    side: input.side,
    qty: 0,
    filledQty: 0,
    state: "created",
    reason: blocked ?? "",
    theoretical: true,
  };
  if (blocked || input.blockOrders) {
    return { ...base, state: transition("created", "rejected"), reason: blocked ?? "Orders are blocked because the trading URL was not the paper host.", theoretical: true };
  }
  const sized = sizePaperOrder(input);
  let qty = input.closing ? input.closeQty : sized.qty;
  const crypto = input.symbol.includes("/");
  if (input.closing && !crypto && input.closeQty < 1) {
    return { ...base, state: transition("created", "rejected"), reason: "There is no long to close.", theoretical: true };
  }
  if (input.closing && crypto && !(input.closeQty > 0)) {
    return { ...base, state: transition("created", "rejected"), reason: "There is no crypto quantity to close.", theoretical: true };
  }
  if (!input.closing && (sized.qty < 1 || sized.reasons.length)) {
    return { ...base, state: transition("created", "rejected"), reason: sized.reasons.join(" ") || "Risk rejected the order.", theoretical: true };
  }
  if (sized.emergency && !input.closing) {
    return { ...base, state: transition("created", "rejected"), reason: sized.reasons.join(" "), theoretical: true };
  }
  let state = transition("created", "risk_approved");
  try {
    const existing = await lookup(transport, creds, id);
    if (existing.status === 200) {
      const mapped = adopt(state, existing.body);
      return { ...mapped, clientOrderId: id, symbol: input.symbol, side: input.side, reason: "Broker already has this client order id. It was not submitted again.", theoretical: false };
    }
  } catch (error) {
    return {
      ...base,
      qty,
      state: transition(state, "unknown_pending_reconciliation"),
      reason: redactSecrets(error instanceof Error ? error.message : "lookup failed", [creds.secret, creds.keyId]),
      theoretical: true,
    };
  }
  state = transition(state, "submitted");
  const url = `${PAPER_TRADING_ORIGIN}/v2/orders`;
  assertPaperUrl(url);
  try {
    const response = await transport.call({
      method: "POST",
      url,
      headers: headers(creds),
      body: {
        symbol: input.symbol,
        qty: String(qty),
        side: input.side,
        type: "market",
        time_in_force: "day",
        client_order_id: id,
      },
    });
    if (response.status >= 200 && response.status < 300) {
      const mapped = adopt(state, response.body);
      return { ...mapped, clientOrderId: id, symbol: input.symbol, side: input.side, qty, theoretical: false, reason: "Accepted by the paper broker. This is not a live order." };
    }
    const message = redactSecrets(JSON.stringify(response.body ?? ""), [creds.secret, creds.keyId]);
    return { ...base, qty, state: transition(state, "rejected"), reason: message || `Paper broker rejected the order (${response.status}).`, theoretical: true };
  } catch (error) {
    return {
      ...base,
      qty,
      state: transition(state, "unknown_pending_reconciliation"),
      reason: redactSecrets(error instanceof Error ? error.message : "submit failed", [creds.secret, creds.keyId]),
      theoretical: true,
    };
  }
}

export function orderFromBroker(body: unknown): BrokerOrder {
  const row = (body ?? {}) as { id?: string; status?: string; filled_qty?: string; qty?: string; client_order_id?: string; symbol?: string; side?: string };
  return {
    clientOrderId: String(row.client_order_id ?? ""),
    brokerId: row.id ? String(row.id) : null,
    symbol: String(row.symbol ?? ""),
    side: row.side === "sell" ? "sell" : "buy",
    qty: Number(row.qty ?? 0),
    filledQty: Number(row.filled_qty ?? 0),
    state: mapBrokerStatus(String(row.status ?? "")),
    reason: "",
    theoretical: false,
  };
}

function adopt(from: BrokerOrderState, body: unknown): BrokerOrder {
  const order = orderFromBroker(body);
  let state = from;
  if (state === "risk_approved") state = transition(state, "submitted");
  if (state !== order.state) state = transition(state, order.state);
  return { ...order, state };
}

export async function resolveUnknownOrder(transport: Transport, creds: Credentials, order: BrokerOrder): Promise<BrokerOrder> {
  if (order.state !== "unknown_pending_reconciliation") return order;
  const existing = await lookup(transport, creds, order.clientOrderId);
  if (existing.status === 404) {
    return { ...order, state: transition(order.state, "rejected"), reason: "Broker has no such order. It was not resubmitted.", theoretical: true };
  }
  if (existing.status === 200) {
    const mapped = adopt(order.state, existing.body);
    return { ...mapped, clientOrderId: order.clientOrderId, reason: "Recovered from the broker. Not resubmitted.", theoretical: false };
  }
  return { ...order, reason: "Broker state is still unknown. Nothing was sent again." };
}

export async function cancelPaperOrder(transport: Transport, creds: Credentials, order: BrokerOrder): Promise<BrokerOrder> {
  if (!order.brokerId || isTerminal(order.state)) return order;
  const pending = { ...order, state: transition(order.state, "pending_cancel") };
  const url = `${PAPER_TRADING_ORIGIN}/v2/orders/${encodeURIComponent(order.brokerId)}`;
  assertPaperUrl(url);
  try {
    const response = await transport.call({ method: "DELETE", url, headers: headers(creds) });
    if (response.status === 204 || response.status === 200) {
      return { ...pending, state: transition(pending.state, "canceled"), reason: "Cancel requested. A late fill is still possible until the broker confirms." };
    }
    return { ...pending, state: transition(pending.state, "unknown_pending_reconciliation"), reason: `Cancel was not confirmed (${response.status}).` };
  } catch (error) {
    return { ...pending, state: transition(pending.state, "unknown_pending_reconciliation"), reason: redactSecrets(error instanceof Error ? error.message : "cancel failed", [creds.secret, creds.keyId]) };
  }
}

export async function replacePaperOrder(transport: Transport, creds: Credentials, order: BrokerOrder, qty: number): Promise<BrokerOrder> {
  if (!order.brokerId || (order.state !== "accepted" && order.state !== "partially_filled")) {
    return { ...order, reason: "Replace is only available on an accepted working order." };
  }
  const url = `${PAPER_TRADING_ORIGIN}/v2/orders/${encodeURIComponent(order.brokerId)}`;
  assertPaperUrl(url);
  const response = await transport.call({ method: "PATCH", url, headers: headers(creds), body: { qty: String(qty) } });
  if (response.status >= 200 && response.status < 300) {
    const mapped = orderFromBroker(response.body);
    return { ...mapped, reason: "Replace sent to the paper broker. The previous order is not assumed dead until the broker says so." };
  }
  return { ...order, state: transition(order.state, "unknown_pending_reconciliation"), reason: "Replace was not confirmed." };
}

export function assertNoLiveUrl(url: string): void {
  assertPaperUrl(url);
  if (new URL(url).hostname === "api.alpaca.markets") throw new Error("Live host blocked.");
}

export const DATA_BARS_PATH = `${DATA_ORIGIN}/v2/stocks/bars`;
