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
  decision: "REJECTED" | "INSUFFICIENT_EVIDENCE";
  reason: string;
}

export function backtestFmz(bars: Bar[], costsBps = 25): FmzBacktest {
  if (bars.length < 300) {
    return { trades: 0, wins: 0, netReturn: 0, profitFactor: null, maxDrawdown: 0, expectancy: 0, benchmark: 0, costsBps, decision: "INSUFFICIENT_EVIDENCE", reason: `only ${bars.length} bars` };
  }
  let cash = 100000;
  let qty = 0;
  let entry = 0;
  let entryIdx = 0;
  let wins = 0;
  let grossWin = 0;
  let grossLoss = 0;
  let trades = 0;
  let peak = cash;
  let maxDd = 0;
  const cost = costsBps / 10000;
  for (let i = 250; i < bars.length - 1; i++) {
    const signal = evaluateFmz(bars.slice(0, i + 1), 250, Date.parse(bars[i].t) + 15 * 60 * 1000);
    const next = bars[i + 1];
    if (qty === 0 && signal.signal === "BUY") {
      const px = next.o * (1 + cost);
      qty = cash / px;
      cash = 0;
      entry = px;
      entryIdx = i + 1;
    } else if (qty > 0) {
      const heldMs = Date.parse(next.t) - Date.parse(bars[entryIdx].t);
      const stop = entry - 1.5 * (signal.atr14 ?? 0);
      const stopHit = next.l <= stop;
      const timeExit = heldMs >= 4 * 60 * 60 * 1000;
      if (signal.signal === "EXIT" || stopHit || timeExit) {
        const px = (stopHit ? stop : next.o) * (1 - cost);
        const proceeds = qty * px;
        const pnl = proceeds - qty * entry;
        if (pnl > 0) { wins++; grossWin += pnl; } else grossLoss += -pnl;
        cash = proceeds;
        qty = 0;
        trades++;
      }
    }
    const equity = cash + qty * next.c;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, (peak - equity) / peak);
  }
  const endEquity = cash + qty * bars.at(-1)!.c;
  const net = endEquity / 100000 - 1;
  const bench = bars.at(-1)!.c / bars[250].c - 1;
  const pf = grossLoss === 0 ? null : grossWin / grossLoss;
  const decision = trades < 30 ? "INSUFFICIENT_EVIDENCE" : net <= 0 ? "REJECTED" : "INSUFFICIENT_EVIDENCE";
  return { trades, wins, netReturn: net, profitFactor: pf, maxDrawdown: maxDd, expectancy: trades ? (endEquity - 100000) / trades : 0, benchmark: bench, costsBps, decision, reason: trades < 30 ? "fewer than 30 closed trades" : "sample does not establish an edge" };
}
