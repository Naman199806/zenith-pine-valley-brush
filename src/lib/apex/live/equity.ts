/**
 * US equity/ETF candidate eligibility for supervised connectivity tests.
 * Read-only. No order submission. Existing crypto path unchanged.
 */

export const EQUITY_CANDIDATES = ["SPY", "QQQ", "IWM", "AAPL", "NVDA"] as const;
export type EquityCandidate = (typeof EQUITY_CANDIDATES)[number];

export interface AssetEligibility {
  symbol: string;
  tradable: boolean;
  fractionable: boolean;
  overnightEligible: boolean;
  minOrderSize: number | null;
  tickSize: number | null;
  blockers: string[];
}

export interface RawAsset {
  symbol?: string;
  tradable?: boolean;
  fractionable?: boolean;
  easy_to_borrow?: boolean;
  overnight_tradable?: boolean;
  min_order_size?: string;
  min_trade_increment?: string;
}

export function evaluateAsset(raw: RawAsset): AssetEligibility {
  const blockers: string[] = [];
  if (!raw.symbol) blockers.push("symbol missing");
  if (raw.tradable !== true) blockers.push("not tradable");
  const min = raw.min_order_size != null ? Number(raw.min_order_size) : null;
  if (min == null || !Number.isFinite(min) || min < 0) blockers.push("minimum ambiguous");
  const tick = raw.min_trade_increment != null ? Number(raw.min_trade_increment) : null;
  if (tick != null && (!Number.isFinite(tick) || tick <= 0)) blockers.push("tick size invalid");
  return {
    symbol: raw.symbol ?? "",
    tradable: raw.tradable === true,
    fractionable: raw.fractionable === true,
    overnightEligible: raw.overnight_tradable === true,
    minOrderSize: min,
    tickSize: tick,
    blockers,
  };
}

export type Session = "REGULAR" | "EXTENDED" | "OVERNIGHT" | "CLOSED";

/** America/New_York session classification. Weekends and a minimal holiday set are CLOSED. */
export function marketSession(now: Date): Session {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const wd = get("weekday");
  const ymd = `${get("year")}-${get("month")}-${get("day")}`;
  const hm = Number(get("hour")) * 60 + Number(get("minute"));
  const holidays = new Set(["2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25"]);
  if (wd === "Sat" || wd === "Sun" || holidays.has(ymd)) return "CLOSED";
  if (hm >= 9 * 60 + 30 && hm < 16 * 60) return "REGULAR";
  if ((hm >= 4 * 60 && hm < 9 * 60 + 30) || (hm >= 16 * 60 && hm < 20 * 60)) return "EXTENDED";
  if (hm >= 20 * 60 || hm < 4 * 60) return "OVERNIGHT";
  return "CLOSED";
}

export interface QuoteCheck {
  ok: boolean;
  reason: string | null;
  spreadBps: number | null;
}

export function validateEquityQuote(quote: { bid: number; ask: number; timestamp: string }, now = Date.now(), maxAgeMs = 15_000, maxSpreadBps = 20): QuoteCheck {
  const ts = Date.parse(quote.timestamp);
  if (!Number.isFinite(ts)) return { ok: false, reason: "quote timestamp invalid", spreadBps: null };
  if (now - ts > maxAgeMs || now - ts < 0) return { ok: false, reason: "quote stale or future", spreadBps: null };
  if (!(quote.bid > 0 && quote.ask > quote.bid)) return { ok: false, reason: "invalid bid/ask", spreadBps: null };
  const mid = (quote.bid + quote.ask) / 2;
  const spreadBps = ((quote.ask - quote.bid) / mid) * 10000;
  if (spreadBps > maxSpreadBps) return { ok: false, reason: `spread ${spreadBps.toFixed(1)} bps`, spreadBps };
  return { ok: true, reason: null, spreadBps };
}
