import type { Bar } from "./competition.ts";

export const HYPOTHESES = {
  "btc-low-vol-cash-v1": {
    id: "btc-low-vol-cash-v1",
    rationale: "Unhedged BTC long exposure is only held when 20-day realized volatility is below a frozen threshold; otherwise cash.",
    failure: "Reject if validation return is not positive after costs, does not beat cash, or has fewer than 12 trades.",
    costsBps: 25,
    volThreshold: 0.04,
  },
  "spy-sma200-cash-v1": {
    id: "spy-sma200-cash-v1",
    rationale: "SPY is held only while its completed close is above the 200-day average; otherwise cash. This is a trend filter, not relative-strength rotation.",
    failure: "Reject if validation underperforms SPY buy-and-hold after costs or has fewer than 8 trades.",
    costsBps: 5,
  },
} as const;

function vol(values: number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
}

export function evalLowVol(bars: Bar[], scoreFrom: string, scoreTo: string, costsBps = 25): { trades: number; net: number; maxDd: number; bench: number; decision: "REJECTED" | "INSUFFICIENT_EVIDENCE" | "ELIGIBLE_FOR_FURTHER_VALIDATION" } {
  let cash = 100000, qty = 0, trades = 0, peak = 100000, maxDd = 0;
  const cost = costsBps / 10000;
  for (let i = 21; i < bars.length - 1; i++) {
    const d = bars[i].t;
    if (d < scoreFrom || d > scoreTo) continue;
    const rets = [];
    for (let k = i - 19; k <= i; k++) rets.push(bars[k].c / bars[k - 1].c - 1);
    const low = vol(rets) < HYPOTHESES["btc-low-vol-cash-v1"].volThreshold;
    const next = bars[i + 1];
    if (low && qty === 0) { qty = cash / (next.o * (1 + cost)); cash = 0; trades++; }
    if (!low && qty > 0) { cash = qty * next.o * (1 - cost); qty = 0; trades++; }
    const eq = cash + qty * bars[i].c;
    peak = Math.max(peak, eq);
    maxDd = Math.max(maxDd, peak ? (peak - eq) / peak : 0);
  }
  const end = cash + qty * bars.at(-1)!.c;
  const net = end / 100000 - 1;
  const start = bars.find((b) => b.t >= scoreFrom) ?? bars[0];
  const bench = bars.at(-1)!.c / start.c - 1;
  const enough = trades >= 12;
  const beats = net > 0 && net > 0 && (end > 100000);
  return { trades, net, maxDd, bench, decision: !enough ? "INSUFFICIENT_EVIDENCE" : beats && net > bench ? "ELIGIBLE_FOR_FURTHER_VALIDATION" : "REJECTED" };
}

export function evalSmaCash(bars: Bar[], scoreFrom: string, scoreTo: string, costsBps = 5): { trades: number; net: number; maxDd: number; bench: number; decision: "REJECTED" | "INSUFFICIENT_EVIDENCE" | "ELIGIBLE_FOR_FURTHER_VALIDATION" } {
  let cash = 100000, qty = 0, trades = 0, peak = 100000, maxDd = 0;
  const cost = costsBps / 10000;
  for (let i = 200; i < bars.length - 1; i++) {
    const d = bars[i].t;
    if (d < scoreFrom || d > scoreTo) continue;
    const sma = bars.slice(i - 199, i + 1).reduce((s, b) => s + b.c, 0) / 200;
    const trend = bars[i].c > sma;
    const next = bars[i + 1];
    if (trend && qty === 0) { qty = cash / (next.o * (1 + cost)); cash = 0; trades++; }
    if (!trend && qty > 0) { cash = qty * next.o * (1 - cost); qty = 0; trades++; }
    const eq = cash + qty * bars[i].c;
    peak = Math.max(peak, eq);
    maxDd = Math.max(maxDd, peak ? (peak - eq) / peak : 0);
  }
  const end = cash + qty * bars.at(-1)!.c;
  const net = end / 100000 - 1;
  const start = bars.find((b) => b.t >= scoreFrom) ?? bars[200];
  const bench = bars.at(-1)!.c / start.c - 1;
  const enough = trades >= 8;
  return { trades, net, maxDd, bench, decision: !enough ? "INSUFFICIENT_EVIDENCE" : net > 0 && net > bench ? "ELIGIBLE_FOR_FURTHER_VALIDATION" : "REJECTED" };
}
