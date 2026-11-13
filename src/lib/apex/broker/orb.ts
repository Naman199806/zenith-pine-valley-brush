import { PAPER_RISK } from "./risk-paper.ts";

export const ORB_STRATEGY = {
  id: "orb-paper-experimental",
  version: "ops-1",
  validated: false as const,
  profitable: false as const,
  note: "Experimental operational signal. The historical opening-range study lost money and is unchanged.",
};

export const ORB_SYMBOLS = ["SPY", "QQQ", "IWM", "GLD", "TLT"] as const;

export interface Bar15 {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface QuoteSnap {
  bid: number;
  ask: number;
  ts: string;
}

export interface OrbSignal {
  symbol: string;
  action: "enter_long" | "flatten" | "skip";
  reason: string;
  experimental: true;
  validated: false;
  rangeHigh: number | null;
  rangeLow: number | null;
  stop: number | null;
  close: number | null;
}

export function etParts(iso: string): { ymd: string; minutes: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date(iso)).map((part) => [part.type, part.value]));
  return { ymd: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

function barStartMinute(iso: string, ymd: string): number | null {
  const parts = etParts(iso);
  if (parts.ymd !== ymd) return null;
  return parts.minutes;
}

export function evaluateOrb(symbol: string, bars: Bar15[], nowIso: string, quote: QuoteSnap | null, adjustment: "raw"): OrbSignal {
  const skip = (reason: string, rangeHigh: number | null = null, rangeLow: number | null = null): OrbSignal => ({
    symbol,
    action: "skip",
    reason,
    experimental: true,
    validated: false,
    rangeHigh,
    rangeLow,
    stop: rangeLow,
    close: null,
  });
  if (adjustment !== "raw") return skip("Adjusted prices are refused.");
  const now = etParts(nowIso);
  if (now.minutes >= PAPER_RISK.flattenMinute) {
    return { symbol, action: "flatten", reason: "Flatten window, 3:55 PM ET. A fill is not guaranteed.", experimental: true, validated: false, rangeHigh: null, rangeLow: null, stop: null, close: null };
  }
  const stamps = bars.map((bar) => bar.t);
  if (new Set(stamps).size !== stamps.length) return skip("Duplicate bars.");
  const today = bars
    .map((bar) => ({ bar, start: barStartMinute(bar.t, now.ymd) }))
    .filter((row): row is { bar: Bar15; start: number } => row.start !== null)
    .sort((a, b) => a.start - b.start);
  const opening = today.find((row) => row.start === 9 * 60 + 30);
  if (!opening) return skip("The 9:30 ET opening bar is missing.");
  if (!(opening.bar.h >= opening.bar.l) || !(opening.bar.v >= 0)) return skip("The opening bar is not a valid price.");
  const completed = today.filter((row) => {
    const end = new Date(row.bar.t).getTime() + 15 * 60 * 1000;
    return end <= new Date(nowIso).getTime();
  });
  const latest = completed[completed.length - 1];
  if (!latest) return skip("No completed bar.", opening.bar.h, opening.bar.l);
  const ageMs = new Date(nowIso).getTime() - (new Date(latest.bar.t).getTime() + 15 * 60 * 1000);
  if (ageMs > 3 * 60 * 1000) return skip("The latest completed bar is stale.", opening.bar.h, opening.bar.l);
  if (now.minutes >= PAPER_RISK.entryCutoffMinute) return skip("The entry window is closed.", opening.bar.h, opening.bar.l);
  if (latest.bar.v < PAPER_RISK.minBarVolume) return skip("Volume is too thin.", opening.bar.h, opening.bar.l);
  if (!quote) return skip("No quote, so spread and freshness cannot be checked.", opening.bar.h, opening.bar.l);
  const quoteAge = new Date(nowIso).getTime() - new Date(quote.ts).getTime();
  if (!Number.isFinite(quoteAge) || quoteAge > 15_000 || quoteAge < -5_000) return skip("The quote is stale.", opening.bar.h, opening.bar.l);
  const mid = (quote.bid + quote.ask) / 2;
  const spreadBps = mid > 0 ? ((quote.ask - quote.bid) / mid) * 10_000 : Infinity;
  if (!(quote.ask >= quote.bid) || spreadBps > PAPER_RISK.maxSpreadBps) return skip("The spread is wider than 10 bps.", opening.bar.h, opening.bar.l);
  if (!(latest.bar.c > opening.bar.h)) return skip("No break above the opening range. Shorts are not taken.", opening.bar.h, opening.bar.l);
  return {
    symbol,
    action: "enter_long",
    reason: "Close broke the 15-minute opening range. Experimental only. Not a validated edge.",
    experimental: true,
    validated: false,
    rangeHigh: opening.bar.h,
    rangeLow: opening.bar.l,
    stop: opening.bar.l,
    close: latest.bar.c,
  };
}
