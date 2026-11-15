/**
 * US equity/ETF session and eligibility.
 * Overnight: 8:00 PM ET Sunday through 4:00 AM ET Friday (Alpaca 24/5).
 * Pre-market 4:00–9:30, regular 9:30–16:00, after-hours 16:00–20:00 ET on weekdays.
 * Friday 8:00 PM ET through Sunday 8:00 PM ET is closed.
 * Calendar exceptions override the hard-coded holiday set.
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

export interface CalendarException {
  date: string; // YYYY-MM-DD ET
  status: "CLOSED" | "SHORTENED";
  earlyCloseEt?: string; // HH:MM
}

const BASE_HOLIDAYS = new Set([
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25",
  "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
]);

function etParts(now: Date): { wd: string; ymd: string; hm: number } {
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
  return {
    wd: get("weekday"),
    ymd: `${get("year")}-${get("month")}-${get("day")}`,
    hm: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

export function marketSession(now: Date, exceptions: CalendarException[] = []): Session {
  const { wd, ymd, hm } = etParts(now);
  const ex = exceptions.find((e) => e.date === ymd);
  if (ex?.status === "CLOSED") return "CLOSED";
  if (BASE_HOLIDAYS.has(ymd) && !exceptions.some((e) => e.date === ymd && e.status !== "CLOSED")) return "CLOSED";

  // Friday 20:00 ET through Sunday 20:00 ET is closed (overnight ends Friday 04:00, reopens Sunday 20:00)
  if (wd === "Sat") return "CLOSED";
  if (wd === "Sun" && hm < 20 * 60) return "CLOSED";
  if (wd === "Fri" && hm >= 20 * 60) return "CLOSED";

  if (ex?.status === "SHORTENED" && ex.earlyCloseEt) {
    const [h, m] = ex.earlyCloseEt.split(":").map(Number);
    const close = (h ?? 13) * 60 + (m ?? 0);
    if (hm >= close) return "CLOSED";
  }

  // Overnight: Sunday 20:00 → Friday 04:00
  if (wd === "Sun" && hm >= 20 * 60) return "OVERNIGHT";
  if ((wd === "Mon" || wd === "Tue" || wd === "Wed" || wd === "Thu") && (hm >= 20 * 60 || hm < 4 * 60)) return "OVERNIGHT";
  if (wd === "Fri" && hm < 4 * 60) return "OVERNIGHT";

  if (hm >= 9 * 60 + 30 && hm < 16 * 60) return "REGULAR";
  if ((hm >= 4 * 60 && hm < 9 * 60 + 30) || (hm >= 16 * 60 && hm < 20 * 60)) return "EXTENDED";
  return "CLOSED";
}

export interface QuoteCheck {
  ok: boolean;
  reason: string | null;
  spreadBps: number | null;
}

export function validateEquityQuote(
  quote: { bid: number; ask: number; timestamp: string },
  now = Date.now(),
  maxAgeMs = 15_000,
  maxSpreadBps = 20,
): QuoteCheck {
  const ts = Date.parse(quote.timestamp);
  if (!Number.isFinite(ts)) return { ok: false, reason: "quote timestamp invalid", spreadBps: null };
  if (now - ts > maxAgeMs || now - ts < 0) return { ok: false, reason: "quote stale or future", spreadBps: null };
  if (!(quote.bid > 0 && quote.ask > quote.bid)) return { ok: false, reason: "invalid bid/ask", spreadBps: null };
  const mid = (quote.bid + quote.ask) / 2;
  const spreadBps = ((quote.ask - quote.bid) / mid) * 10000;
  if (spreadBps > maxSpreadBps) return { ok: false, reason: `spread ${spreadBps.toFixed(1)} bps`, spreadBps };
  return { ok: true, reason: null, spreadBps };
}

/** Worst-case BUY notional = qty × limit × (1 + cost buffer). Never trust maxNotional alone. */
export function worstCaseNotional(qty: number, limitPrice: number, costBufferBps = 10): number {
  if (!(qty > 0) || !(limitPrice > 0)) return Number.POSITIVE_INFINITY;
  return qty * limitPrice * (1 + costBufferBps / 10000);
}
