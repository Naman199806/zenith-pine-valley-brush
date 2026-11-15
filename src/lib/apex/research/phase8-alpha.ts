import type { Bar } from "./competition.ts";

export const ALPHA_AUDIT = {
  equities: { symbols: ["SPY", "QQQ", "IWM", "GLD", "TLT", "BIL"], timeframe: "daily", source: "Yahoo chart API, split-adjusted OHLC, adjclose separate", feasibility: 1 },
  crypto: { symbols: ["BTC-USD", "ETH-USD"], timeframe: "daily", source: "Coinbase public candles from 2024-01-01", feasibility: 2 },
  volatility: { symbols: ["^VIX"], timeframe: "daily index level", source: "Yahoo chart API fetched 2026-11-15", note: "not a tradable fill", feasibility: 1 },
  missing: ["options chains", "VIX futures", "funding rates", "perp basis", "order book", "historical announcement timestamps"],
} as const;

export const HYPOTHESES = [
  { rank: 1, id: "spy-vix-regime-v1", status: "TESTABLE", mechanism: "equity returns have historically been weaker in high-implied-vol regimes; the premium is paid by hedgers who buy protection" },
  { rank: 2, id: "macro-event-v1", status: "NOT_TESTABLE", reason: "no historical point-in-time announcement timestamps aligned to prices" },
  { rank: 3, id: "crypto-funding-basis-v1", status: "NOT_TESTABLE", reason: "no historical funding, basis, or executable order-book data" },
] as const;

export const FROZEN = {
  id: "spy-vix-regime-v1",
  frozen: true,
  rules: "Long SPY only when the prior completed VIX close is below its own 20-session average. Otherwise cash. Fill SPY at the next open. VIX is a signal only, never a fill. No shorting.",
  costsBps: 5,
  development: ["1993-01-29", "2023-12-31"],
  validation: ["2024-01-01", "2025-11-10"],
  holdout: "2025-11-11 onward sealed",
  fail: "Reject unless validation beats SPY buy-and-hold after costs, has at least 8 trades, and positive net.",
} as const;

export function evalRegime(spy: Bar[], vix: Bar[], from: string, to: string) {
  const vixBy = new Map(vix.map((b) => [b.t, b.c]));
  const rows = spy.filter((b) => b.t >= from && b.t <= to && vixBy.has(b.t));
  const vixCloses = rows.map((b) => vixBy.get(b.t)!);
  let cash = 100000, qty = 0, trades = 0, peak = 100000, maxDd = 0;
  for (let i = 20; i < rows.length - 1; i++) {
    const avg = vixCloses.slice(i - 20, i).reduce((s, v) => s + v, 0) / 20;
    const long = vixCloses[i - 1] < avg;
    const next = rows[i + 1];
    if (long && qty === 0) { qty = cash / (next.o * 1.0005); cash = 0; trades++; }
    if (!long && qty > 0) { cash = qty * next.o * 0.9995; qty = 0; trades++; }
    const eq = cash + qty * rows[i].c;
    peak = Math.max(peak, eq);
    maxDd = Math.max(maxDd, peak ? (peak - eq) / peak : 0);
  }
  const end = cash + qty * rows.at(-1)!.c;
  const net = end / 100000 - 1;
  const bench = rows.at(-1)!.c / rows[0].c - 1;
  return { trades, net, maxDd, bench, decision: trades >= 8 && net > 0 && net > bench ? "ELIGIBLE_FOR_FURTHER_VALIDATION" : "REJECTED" };
}
