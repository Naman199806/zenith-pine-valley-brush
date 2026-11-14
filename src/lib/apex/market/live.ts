export type Freshness = "FRESH" | "DELAYED" | "STALE" | "UNAVAILABLE";

export interface Quote {
  symbol: string;
  price: number | null;
  observedAt: string | null;
  fetchedAt: string;
  ageMs: number | null;
  source: string;
  session: "OPEN" | "CLOSED" | "ALWAYS" | "UNKNOWN";
  complete: boolean;
  status: Freshness;
  reason: string;
}

export interface Snapshot {
  fetchedAt: string;
  attempts: number;
  quotes: Quote[];
  lastKnown: Quote[];
}

const STOCKS = ["SPY", "QQQ", "TSLA", "NFLX", "VOO"];
const CRYPTO = [
  ["BTC/USD", "BTC-USD"],
  ["ETH/USD", "ETH-USD"],
  ["SOL/USD", "SOL-USD"],
] as const;

export function sessionStatus(now = Date.now()): "OPEN" | "CLOSED" {
  const et = new Date(now).toLocaleString("en-US", { timeZone: "America/New_York", hour12: false });
  const [date, time] = et.split(", ");
  const [hour, minute] = time.split(":").map(Number);
  const day = new Date(date).getDay();
  const mins = hour * 60 + minute;
  return day >= 1 && day <= 5 && mins >= 9 * 60 + 30 && mins < 16 * 60 ? "OPEN" : "CLOSED";
}

export async function snapshot(fetchImpl: typeof fetch = fetch, now = Date.now(), lastKnown: Quote[] = [], timeoutMs = 4000): Promise<Snapshot> {
  const fetchedAt = new Date(now).toISOString();
  const bounded = withTimeout(fetchImpl, timeoutMs);
  const stocks = await Promise.all(STOCKS.map((symbol) => yahoo(symbol, bounded, now, fetchedAt)));
  const crypto = await Promise.all(CRYPTO.map(([label, id]) => coinbase(label, id, bounded, now, fetchedAt)));
  const quotes = [...stocks, ...crypto];
  const merged = quotes.map((quote) => quote.status === "UNAVAILABLE" ? lastKnown.find((old) => old.symbol === quote.symbol) ?? quote : quote);
  return { fetchedAt, attempts: 1, quotes: merged, lastKnown: merged };
}

export function replaceAtomic(current: Snapshot | null, next: Snapshot): Snapshot {
  return { ...next, attempts: (current?.attempts ?? 0) + next.attempts, lastKnown: next.lastKnown };
}

async function yahoo(symbol: string, fetchImpl: typeof fetch, now: number, fetchedAt: string): Promise<Quote> {
  try {
    const res = await fetchImpl(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=5d`);
    if (!res.ok) return unavailable(symbol, "yahoo", `HTTP ${res.status}`, fetchedAt);
    const body = await res.json() as { chart?: { result?: { meta?: { regularMarketPrice?: number; regularMarketTime?: number } }[] } };
    const meta = body.chart?.result?.[0]?.meta;
    const price = meta?.regularMarketPrice ?? null;
    const observedAt = meta?.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : null;
    if (price == null || !observedAt) return unavailable(symbol, "yahoo", "missing price", fetchedAt);
    const session = sessionStatus(now);
    return {
      symbol, price, observedAt, fetchedAt, ageMs: now - Date.parse(observedAt), source: "yahoo",
      session, complete: true, status: equityStatus(observedAt, now, session), reason: session === "CLOSED" ? "US equity session closed" : "read-only quote",
    };
  } catch {
    return unavailable(symbol, "yahoo", "provider unreachable", fetchedAt);
  }
}

async function coinbase(label: string, id: string, fetchImpl: typeof fetch, now: number, fetchedAt: string): Promise<Quote> {
  try {
    const end = Math.floor(now / 1000);
    const start = end - 3 * 86400;
    const res = await fetchImpl(`https://api.exchange.coinbase.com/products/${id}/candles?granularity=86400&start=${start}&end=${end}`);
    if (!res.ok) return unavailable(label, "coinbase", `HTTP ${res.status}`, fetchedAt);
    const rows = await res.json() as number[][];
    const latest = Array.isArray(rows) ? rows.sort((a, b) => b[0] - a[0])[0] : null;
    if (!latest) return unavailable(label, "coinbase", "no candles", fetchedAt);
    const observedAt = new Date(latest[0] * 1000).toISOString();
    const complete = now - latest[0] * 1000 > 86400_000;
    return {
      symbol: label, price: latest[4], observedAt, fetchedAt, ageMs: now - Date.parse(observedAt), source: "coinbase",
      session: "ALWAYS", complete, status: ageStatus(observedAt, now, 15 * 60_000, 6 * 3600_000),
      reason: complete ? "completed daily candle" : "incomplete current candle, not a strategy bar",
    };
  } catch {
    return unavailable(label, "coinbase", "provider unreachable", fetchedAt);
  }
}

function equityStatus(observedAt: string, now: number, session: "OPEN" | "CLOSED"): Freshness {
  if (session === "CLOSED") return "DELAYED";
  return ageStatus(observedAt, now, 20 * 60_000, 36 * 3600_000);
}

function ageStatus(observedAt: string, now: number, freshMs: number, staleMs: number): Freshness {
  const age = now - Date.parse(observedAt);
  if (age <= freshMs) return "FRESH";
  if (age <= staleMs) return "DELAYED";
  return "STALE";
}

function withTimeout(fetchImpl: typeof fetch, timeoutMs: number): typeof fetch {
  return (async (input, init) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchImpl(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }) as typeof fetch;
}

export function backoffMs(failures: number): number {
  return Math.min(20_000 * 2 ** Math.min(failures, 4), 5 * 60_000);
}

function unavailable(symbol: string, source: string, reason: string, fetchedAt: string): Quote {
  return { symbol, price: null, observedAt: null, fetchedAt, ageMs: null, source, session: "UNKNOWN", complete: false, status: "UNAVAILABLE", reason };
}
