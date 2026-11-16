/**
 * Authenticated GET-only Alpaca PAPER client.
 * Exact paper host only. LIVE host and non-PK keys are rejected.
 * Never submits. Never logs credentials.
 */

import { PAPER_TRADING_ORIGIN, LIVE_TRADING_ORIGIN, assertPaperUrl } from "./allowlist.ts";

export interface PaperCreds {
  keyId: string;
  secret: string;
}

export interface BrokerOrder {
  id: string;
  client_order_id: string;
  symbol: string;
  side: string;
  status: string;
  filled_qty: string;
  filled_avg_price: string | null;
  filled_at: string | null;
  submitted_at: string | null;
}

export interface PaperReadResult {
  ok: boolean;
  verdict: "VERIFIED" | "NO-GO";
  host: string;
  method: "GET";
  submitted: false;
  blockers: string[];
  orders: BrokerOrder[];
  positions: number | null;
  openOrders: number | null;
}

export function assertPaperCreds(creds: PaperCreds, host = PAPER_TRADING_ORIGIN): string | null {
  if (host !== PAPER_TRADING_ORIGIN) return "LIVE host rejected";
  if (host === LIVE_TRADING_ORIGIN) return "LIVE host rejected";
  if (!creds.keyId.startsWith("PK")) return "LIVE or non-paper key rejected";
  if (!creds.secret) return "missing paper secret";
  return null;
}

export async function paperGet(creds: PaperCreds, path: string): Promise<{ status: number; body: unknown }> {
  const err = assertPaperCreds(creds);
  if (err) throw new Error(err);
  const url = assertPaperUrl(`${PAPER_TRADING_ORIGIN}${path}`);
  if (url.hostname !== "paper-api.alpaca.markets") throw new Error("LIVE host rejected");
  const res = await fetch(url, {
    method: "GET",
    headers: {
      "APCA-API-KEY-ID": creds.keyId,
      "APCA-API-SECRET-KEY": creds.secret,
    },
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

export function sanitizeOrder(raw: unknown): BrokerOrder | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.client_order_id !== "string") return null;
  return {
    id: o.id,
    client_order_id: o.client_order_id,
    symbol: String(o.symbol ?? ""),
    side: String(o.side ?? ""),
    status: String(o.status ?? ""),
    filled_qty: String(o.filled_qty ?? ""),
    filled_avg_price: o.filled_avg_price == null ? null : String(o.filled_avg_price),
    filled_at: o.filled_at == null ? null : String(o.filled_at),
    submitted_at: o.submitted_at == null ? null : String(o.submitted_at),
  };
}

export async function verifyExistingPaperOrders(creds: PaperCreds, ids: string[]): Promise<PaperReadResult> {
  const blockers: string[] = [];
  const credErr = assertPaperCreds(creds);
  if (credErr) return { ok: false, verdict: "NO-GO", host: PAPER_TRADING_ORIGIN, method: "GET", submitted: false, blockers: [credErr], orders: [], positions: null, openOrders: null };
  const orders: BrokerOrder[] = [];
  for (const id of ids) {
    const res = await paperGet(creds, `/v2/orders/${id}`);
    const order = sanitizeOrder(res.body);
    if (res.status !== 200 || !order) blockers.push(`order ${id} unavailable (${res.status})`);
    else orders.push(order);
  }
  const positions = await paperGet(creds, "/v2/positions");
  const open = await paperGet(creds, "/v2/orders?status=open");
  if (positions.status !== 200 || !Array.isArray(positions.body)) blockers.push("positions unavailable");
  if (open.status !== 200 || !Array.isArray(open.body)) blockers.push("open orders unavailable");
  if (orders.length === 0) blockers.push("empty order list");
  return {
    ok: blockers.length === 0,
    verdict: blockers.length === 0 ? "VERIFIED" : "NO-GO",
    host: PAPER_TRADING_ORIGIN,
    method: "GET",
    submitted: false,
    blockers,
    orders,
    positions: Array.isArray(positions.body) ? positions.body.length : null,
    openOrders: Array.isArray(open.body) ? open.body.length : null,
  };
}
