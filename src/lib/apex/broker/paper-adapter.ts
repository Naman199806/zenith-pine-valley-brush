import { assertPaperUrl, PAPER_TRADING_ORIGIN } from "./allowlist.ts";

export interface SerializedOrder {
  method: "POST";
  url: string;
  body: { symbol: string; qty: string; side: "buy" | "sell"; type: "market"; time_in_force: "gtc"; client_order_id: string };
}

export function serializeOrder(input: { symbol: string; qty: number; side: "buy" | "sell"; clientOrderId: string }): SerializedOrder {
  if (!(input.qty > 0)) throw new Error("quantity must be positive");
  const qty = Math.floor(input.qty * 1e8) / 1e8;
  const url = `${PAPER_TRADING_ORIGIN}/v2/orders`;
  assertPaperUrl(url);
  return { method: "POST", url, body: { symbol: input.symbol, qty: qty.toFixed(8), side: input.side, type: "market", time_in_force: "gtc", client_order_id: input.clientOrderId } };
}

export function parseBrokerOrder(body: unknown): { id: string; clientOrderId: string; status: string; filledQty: number } {
  const order = body as { id?: string; client_order_id?: string; status?: string; filled_qty?: string };
  if (!order.id || !order.client_order_id || !order.status) throw new Error("malformed broker order");
  return { id: order.id, clientOrderId: order.client_order_id, status: order.status, filledQty: Number(order.filled_qty || 0) };
}

export async function readPaperAccount(transport: { get(url: string): Promise<{ status: number; body: unknown }> }): Promise<{ ok: boolean; status: string; positions: number; orders: number; error: string | null }> {
  const account = await transport.get(`${PAPER_TRADING_ORIGIN}/v2/account`);
  if (account.status !== 200) return { ok: false, status: "FAILED", positions: 0, orders: 0, error: `account ${account.status}` };
  const positions = await transport.get(`${PAPER_TRADING_ORIGIN}/v2/positions`);
  const orders = await transport.get(`${PAPER_TRADING_ORIGIN}/v2/orders?status=open`);
  return { ok: true, status: String((account.body as { status?: string }).status || "UNKNOWN"), positions: Array.isArray(positions.body) ? positions.body.length : 0, orders: Array.isArray(orders.body) ? orders.body.length : 0, error: null };
}
