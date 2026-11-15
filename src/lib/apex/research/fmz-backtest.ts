import { evaluateFmz, type Bar } from "./fmz-bb-rsi.ts";

export interface FmzBacktest {
  trades: number;
  wins: number;
  netReturn: number;
  profitFactor: number | null;
  maxDrawdown: number;
  expectancy: number;
  benchmark: number;
  costsBps: number;
  unfilledStops: number;
  missingCandles: number;
  decision: "REJECTED" | "INSUFFICIENT_EVIDENCE";
  reason: string;
}

export function missingCandles(bars: Bar[], timeframeMs = 900000): number {
  let missing = 0;
  for (let i = 1; i < bars.length; i++) {
    const gap = Date.parse(bars[i].t) - Date.parse(bars[i - 1].t);
    if (gap > timeframeMs * 1.5) missing += Math.round(gap / timeframeMs) - 1;
  }
  return missing;
}

export function backtestFmz(bars: Bar[], opts: { costsBps?: number; notionalUsd?: number; equityUsd?: number } = {}): FmzBacktest {
  const costsBps = opts.costsBps ?? 25;
  const equityUsd = opts.equityUsd ?? 100000;
  const notionalUsd = opts.notionalUsd ?? 25;
  const missing = missingCandles(bars);
  if (bars.length < 300) return { trades: 0, wins: 0, netReturn: 0, profitFactor: null, maxDrawdown: 0, expectancy: 0, benchmark: 0, costsBps, unfilledStops: 0, missingCandles: missing, decision: "INSUFFICIENT_EVIDENCE", reason: `only ${bars.length} bars` };
  let cash = equityUsd;
  let qty = 0;
  let entry = 0;
  let entryIdx = 0;
  let wins = 0;
  let grossWin = 0;
  let grossLoss = 0;
  let trades = 0;
  let unfilledStops = 0;
  let peak = cash;
  let maxDd = 0;
  const cost = costsBps / 10000;
  for (let i = 250; i < bars.length - 1; i++) {
    const signal = evaluateFmz(bars.slice(0, i + 1), 250, Date.parse(bars[i].t) + 900000);
    const next = bars[i + 1];
    if (qty === 0 && signal.signal === "BUY") {
      const px = next.o * (1 + cost);
      const budget = Math.min(notionalUsd, cash);
      qty = Math.floor((budget / px) * 1e8) / 1e8;
      if (qty <= 0) continue;
      cash -= qty * px;
      entry = px;
      entryIdx = i + 1;
    } else if (qty > 0) {
      const heldMs = Date.parse(next.t) - Date.parse(bars[entryIdx].t);
      const stop = entry - 1.5 * (signal.atr14 ?? 0);
      const limit = stop * 0.995;
      const stopHit = next.l <= stop;
      const gapThrough = next.o < limit;
      const timeExit = heldMs >= 4 * 60 * 60 * 1000;
      const signalExit = signal.signal === "EXIT";
      if (stopHit && !gapThrough && next.l > limit && next.h < stop) {
        unfilledStops++;
        continue;
      }
      if (signalExit || stopHit || timeExit) {
        const raw = stopHit ? (gapThrough || next.o < stop ? next.o : stop) : next.o;
        const px = raw * (1 - cost);
        const proceeds = qty * px;
        const pnl = proceeds - qty * entry;
        if (pnl > 0) { wins++; grossWin += pnl; } else grossLoss += -pnl;
        cash += proceeds;
        qty = 0;
        trades++;
      }
    }
    const equity = cash + qty * next.c;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, peak === 0 ? 0 : (peak - equity) / peak);
  }
  const endEquity = cash + qty * bars.at(-1)!.c;
  const net = endEquity / equityUsd - 1;
  const bench = bars.at(-1)!.c / bars[250].c - 1;
  const pf = grossLoss === 0 ? null : grossWin / grossLoss;
  const decision = trades < 30 || bars.length < 10000 ? "INSUFFICIENT_EVIDENCE" : net <= 0 ? "REJECTED" : "INSUFFICIENT_EVIDENCE";
  return { trades, wins, netReturn: net, profitFactor: pf, maxDrawdown: maxDd, expectancy: trades ? (endEquity - equityUsd) / trades : 0, benchmark: bench, costsBps, unfilledStops, missingCandles: missing, decision, reason: trades < 30 ? "fewer than 30 closed trades" : bars.length < 10000 ? "history shorter than the research minimum" : "no credible edge" };
}
