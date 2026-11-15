import type { Bar } from "./competition.ts";

export const PHASE8_PLAN = [
  { rank: 1, id: "spy-dual-momentum-v1", source: "absolute dual momentum", instruments: ["SPY"], regime: "equity trend", data: "Yahoo SPY daily 1993-2025, sealed after 2025-11-11", frequency: "monthly-equivalent, checked daily", capacity: "high", costsBps: 5, pass: "validation beats SPY buy-and-hold after costs with at least 8 trades and positive net" },
  { rank: 2, id: "gld-equity-stress-v1", source: "equity stress to gold hedge", instruments: ["SPY", "GLD"], regime: "risk-off", data: "Yahoo SPY/GLD daily", frequency: "low", capacity: "high", costsBps: 5, pass: "not tested this phase" },
  { rank: 3, id: "btc-weekday-seasonality-v1", source: "calendar seasonality", instruments: ["BTC/USD"], regime: "crypto microstructure", data: "Coinbase daily", frequency: "daily", capacity: "medium", costsBps: 25, pass: "not tested; lower plausibility and higher data-mining risk" },
] as const;

export const FROZEN = {
  id: "spy-dual-momentum-v1",
  frozen: true,
  rules: "Long SPY only when the completed close is above both the 63-session and 252-session prior close. Otherwise cash. Fill next open. No shorting.",
  costsBps: 5,
  development: ["1993-01-29", "2023-12-31"],
  validation: ["2024-01-01", "2025-11-10"],
  holdout: "2025-11-11 onward sealed",
} as const;

export function evalDual(bars: Bar[], from: string, to: string) {
  const rows = bars.filter((b) => b.t >= from && b.t <= to);
  let cash = 100000, qty = 0, trades = 0, peak = 100000, maxDd = 0;
  for (let i = 252; i < rows.length - 1; i++) {
    const long = rows[i].c > rows[i - 63].c && rows[i].c > rows[i - 252].c;
    const next = rows[i + 1];
    if (long && qty === 0) { qty = cash / (next.o * 1.0005); cash = 0; trades++; }
    if (!long && qty > 0) { cash = qty * next.o * 0.9995; qty = 0; trades++; }
    const eq = cash + qty * rows[i].c;
    peak = Math.max(peak, eq);
    maxDd = Math.max(maxDd, peak ? (peak - eq) / peak : 0);
  }
  const end = cash + qty * rows.at(-1)!.c;
  const bench = rows.at(-1)!.c / rows[0].c - 1;
  const net = end / 100000 - 1;
  return { trades, net, maxDd, bench, decision: trades >= 8 && net > 0 && net > bench ? "ELIGIBLE_FOR_FURTHER_VALIDATION" : "REJECTED" };
}
