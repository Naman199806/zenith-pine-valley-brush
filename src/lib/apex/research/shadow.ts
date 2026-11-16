/**
 * Shadow data-quality and broker reconciliation.
 * Read-only. Never submits.
 */

import { PAPER_TRADING_ORIGIN, DATA_ORIGIN, assertPaperUrl } from "../broker/allowlist.ts";
import { assertPaperCreds, type PaperCreds } from "../broker/paper-read.ts";
import type { Bar } from "./canonical-decision.ts";

export interface DataQuality {
  dataOk: boolean;
  reasons: string[];
  asOf: string | null;
  provenance: string;
}

export function assessBars(symbol: string, bars: Bar[], now = Date.now()): DataQuality {
  const reasons: string[] = [];
  if (bars.length < 201) reasons.push(`${symbol} insufficient bars`);
  let prev = "";
  for (const b of bars) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date)) reasons.push(`${symbol} invalid date`);
    if (prev && b.date <= prev) reasons.push(`${symbol} not chronological`);
    if (![b.open, b.high, b.low, b.close].every((n) => Number.isFinite(n) && n > 0)) reasons.push(`${symbol} nonfinite price`);
    if (b.date > new Date(now).toISOString().slice(0, 10)) reasons.push(`${symbol} future bar`);
    prev = b.date;
  }
  const last = bars.at(-1)?.date ?? null;
  if (last) {
    const ageDays = (now - Date.parse(`${last}T21:00:00Z`)) / 86_400_000;
    if (!Number.isFinite(ageDays) || ageDays > 5) reasons.push(`${symbol} stale`);
  }
  return { dataOk: reasons.length === 0, reasons, asOf: last ? `${last}T21:00:00Z` : null, provenance: "shadow-refreshed" };
}

export interface BrokerState {
  ok: boolean;
  reasons: string[];
  ownedQty: number;
  openExitQty: number;
}

export async function reconcilePaperPosition(
  creds: PaperCreds,
  symbol: string,
  get: (url: string) => Promise<{ status: number; body: unknown }>,
): Promise<BrokerState> {
  const credErr = assertPaperCreds(creds);
  if (credErr) return { ok: false, reasons: [credErr], ownedQty: 0, openExitQty: 0 };
  const positionsUrl = assertPaperUrl(`${PAPER_TRADING_ORIGIN}/v2/positions`).toString();
  const ordersUrl = assertPaperUrl(`${PAPER_TRADING_ORIGIN}/v2/orders?status=open`).toString();
  const positions = await get(positionsUrl);
  const orders = await get(ordersUrl);
  const reasons: string[] = [];
  if (positions.status !== 200 || !Array.isArray(positions.body)) reasons.push("positions incomplete");
  if (orders.status !== 200 || !Array.isArray(orders.body)) reasons.push("open orders incomplete");
  if (reasons.length) return { ok: false, reasons, ownedQty: 0, openExitQty: 0 };
  const owned = (positions.body as { symbol?: string; qty?: string }[]).find((p) => p.symbol === symbol);
  const ownedQty = owned ? Number(owned.qty) : 0;
  const openExitQty = (orders.body as { symbol?: string; side?: string; qty?: string }[])
    .filter((o) => o.symbol === symbol && o.side === "sell")
    .reduce((sum, o) => sum + Number(o.qty || 0), 0);
  if (!Number.isFinite(ownedQty) || ownedQty < 0 || !Number.isFinite(openExitQty)) reasons.push("broker quantity nonfinite");
  return { ok: reasons.length === 0, reasons, ownedQty, openExitQty };
}

export function barsUrl(symbol: string): string {
  return assertPaperUrl(`${DATA_ORIGIN}/v2/stocks/${symbol}/bars?timeframe=1Day&feed=iex&start=2025-01-02&limit=1000`).toString();
}
