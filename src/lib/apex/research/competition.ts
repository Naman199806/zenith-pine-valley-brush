export interface Bar { t: string; o: number; h: number; l: number; c: number; }

function ema(values: number[], n: number): number | null {
  if (values.length < n) return null;
  const k = 2 / (n + 1);
  let e = values.slice(0, n).reduce((a, b) => a + b, 0) / n;
  for (const v of values.slice(n)) e = v * k + e * (1 - k);
  return e;
}
function rsi(values: number[], n: number): number | null {
  if (values.length < n + 1) return null;
  let gain = 0, loss = 0;
  for (let i = values.length - n; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  if (loss === 0) return 100;
  return 100 - 100 / (1 + gain / loss);
}
function atr(bars: Bar[], n = 14): number | null {
  if (bars.length < n + 1) return null;
  const trs = [];
  for (let i = 1; i < bars.length; i++) trs.push(Math.max(bars[i].h - bars[i].l, Math.abs(bars[i].h - bars[i - 1].c), Math.abs(bars[i].l - bars[i - 1].c)));
  let a = trs.slice(0, n).reduce((x, y) => x + y, 0) / n;
  for (const tr of trs.slice(n)) a = (a * (n - 1) + tr) / n;
  return a;
}

export interface Result {
  id: string;
  trades: number;
  wins: number;
  netReturn: number;
  profitFactor: number | null;
  maxDrawdown: number;
  expectancy: number;
  benchmark: number;
  decision: "REJECTED" | "INSUFFICIENT_EVIDENCE" | "ELIGIBLE_FOR_FURTHER_VALIDATION";
  reason: string;
  holdoutUsed: false;
}

function finish(id: string, trades: number, wins: number, end: number, start: number, grossWin: number, grossLoss: number, maxDd: number, bench: number, minTrades: number): Result {
  const net = end / start - 1;
  const pf = grossLoss === 0 ? null : grossWin / grossLoss;
  const exp = trades ? (end - start) / trades : 0;
  const enough = trades >= minTrades;
  const beats = net > 0 && net > bench && (pf ?? 0) > 1.2 && maxDd < 0.25;
  return { id, trades, wins, netReturn: net, profitFactor: pf, maxDrawdown: maxDd, expectancy: exp, benchmark: bench, decision: !enough ? "INSUFFICIENT_EVIDENCE" : beats ? "ELIGIBLE_FOR_FURTHER_VALIDATION" : "REJECTED", reason: !enough ? "too few trades" : beats ? "passes pre-registered validation gates" : "fails return, profit factor, drawdown, or benchmark gate", holdoutUsed: false };
}

export function evalDonchian(bars: Bar[], costsBps = 25, scoreFrom = "0000-01-01", scoreTo = "9999-12-31"): Result {
  let cash = 100000, qty = 0, entry = 0, wins = 0, gw = 0, gl = 0, trades = 0, peak = cash, maxDd = 0;
  const cost = costsBps / 10000;
  for (let i = 120; i < bars.length - 1; i++) {
    const w = bars.slice(0, i + 1);
    const closes = w.map((b) => b.c);
    const e100 = ema(closes, 100);
    const hi = Math.max(...w.slice(-21, -1).map((b) => b.h));
    const lo = Math.min(...w.slice(-11, -1).map((b) => b.l));
    const a = atr(w);
    const next = bars[i + 1];
    const inScore = w.at(-1)!.t >= scoreFrom && w.at(-1)!.t <= scoreTo;
    if (qty === 0 && inScore && e100 != null && w.at(-1)!.c > hi && w.at(-1)!.c > e100) {
      const px = next.o * (1 + cost);
      const budget = cash * 0.2;
      qty = budget / px;
      cash -= budget;
      entry = px;
    } else if (qty > 0) {
      const stop = entry - 2 * (a ?? 0);
      const exit = (e100 != null && w.at(-1)!.c < e100) || w.at(-1)!.c < lo || next.l <= stop;
      if (exit) {
        const raw = next.l <= stop ? Math.min(next.o, stop) : next.o;
        const px = raw * (1 - cost);
        const pnl = qty * px - qty * entry;
        if (pnl > 0) { wins++; gw += pnl; } else gl += -pnl;
        cash += qty * px;
        qty = 0;
        trades++;
      }
    }
    const eq = cash + qty * next.c;
    peak = Math.max(peak, eq);
    maxDd = Math.max(maxDd, (peak - eq) / peak);
  }
  const end = cash + qty * bars.at(-1)!.c;
  return finish("btc-donchian-breakout-v1", trades, wins, end, 100000, gw, gl, maxDd, bars.at(-1)!.c / bars[120].c - 1, 20);
}

export function evalMeanRevert(bars: Bar[], costsBps = 25, scoreFrom = "0000-01-01", scoreTo = "9999-12-31"): Result {
  let cash = 100000, qty = 0, entry = 0, held = 0, wins = 0, gw = 0, gl = 0, trades = 0, peak = cash, maxDd = 0;
  const cost = costsBps / 10000;
  for (let i = 210; i < bars.length - 1; i++) {
    const w = bars.slice(0, i + 1);
    const closes = w.map((b) => b.c);
    const e200 = ema(closes, 200);
    const e5 = ema(closes, 5);
    const r = rsi(closes, 2);
    const next = bars[i + 1];
    const inScore = w.at(-1)!.t >= scoreFrom && w.at(-1)!.t <= scoreTo;
    if (qty === 0 && inScore && e200 != null && r != null && r < 10 && w.at(-1)!.c > e200) {
      const px = next.o * (1 + cost);
      const budget = cash * 0.2;
      qty = budget / px;
      cash -= budget;
      entry = px;
      held = 0;
    } else if (qty > 0) {
      held++;
      if ((e5 != null && w.at(-1)!.c > e5) || held >= 5) {
        const px = next.o * (1 - cost);
        const pnl = qty * px - qty * entry;
        if (pnl > 0) { wins++; gw += pnl; } else gl += -pnl;
        cash += qty * px;
        qty = 0;
        trades++;
      }
    }
    const eq = cash + qty * next.c;
    peak = Math.max(peak, eq);
    maxDd = Math.max(maxDd, (peak - eq) / peak);
  }
  const end = cash + qty * bars.at(-1)!.c;
  return finish("btc-mean-revert-regime-v1", trades, wins, end, 100000, gw, gl, maxDd, bars.at(-1)!.c / bars[210].c - 1, 20);
}

export interface RotationTrade {
  entryDate: string;
  exitDate: string | null;
  asset: string;
  entryPrice: number;
  exitPrice: number | null;
  qty: number;
  realizedPnl: number | null;
}

export function evalDefensiveRs(series: Record<string, Bar[]>, costsBps = 5, scoreFrom = "0000-01-01", scoreTo = "9999-12-31"): Result & { tradesDetail: RotationTrade[]; priceOnly: true; equityReconciled: boolean } {
  const dates = series.SPY.map((b) => b.t);
  const by = Object.fromEntries(Object.entries(series).map(([k, v]) => [k, new Map(v.map((b) => [b.t, b]))]));
  let cash = 100000, asset = "CASH", qty = 0, wins = 0, gw = 0, gl = 0, trades = 0, peak = 100000, maxDd = 0, lastMonth = "";
  const detail: RotationTrade[] = [];
  const cost = costsBps / 10000;
  let open: RotationTrade | null = null;
  for (let i = 80; i < dates.length - 1; i++) {
    const d = dates[i];
    const month = d.slice(0, 7);
    const inScore = d >= scoreFrom && d <= scoreTo;
    if (month !== lastMonth && inScore) {
      lastMonth = month;
      const scores = ["SPY", "QQQ", "IWM", "GLD", "TLT", "BIL"].map((s) => {
        const now = by[s].get(d)?.c;
        const prev = by[s].get(dates[i - 60])?.c;
        return { s, r: now && prev ? now / prev - 1 : -Infinity };
      }).sort((a, b) => b.r - a.r);
      const pick = scores[0].r < 0 ? "BIL" : scores[0].s;
      const nextDate = dates[i + 1];
      const next = by[pick].get(nextDate);
      if (next && pick !== asset) {
        if (open && qty) {
          const exitPx = (by[asset].get(nextDate)?.o ?? by[asset].get(d)!.c) * (1 - cost);
          const proceeds = qty * exitPx;
          const pnl = proceeds - qty * open.entryPrice;
          open.exitDate = nextDate;
          open.exitPrice = exitPx;
          open.realizedPnl = pnl;
          if (pnl > 0) { wins++; gw += pnl; } else gl += -pnl;
          cash += proceeds;
          detail.push(open);
          qty = 0;
        }
        const entryPx = next.o * (1 + cost);
        qty = cash / entryPx;
        cash = 0;
        open = { entryDate: nextDate, exitDate: null, asset: pick, entryPrice: entryPx, exitPrice: null, realizedPnl: null, qty };
        asset = pick;
        trades++;
      }
    }
    const mark = asset === "CASH" ? 0 : by[asset].get(d)?.c ?? 0;
    const eq = cash + qty * mark;
    peak = Math.max(peak, eq);
    maxDd = Math.max(maxDd, peak ? (peak - eq) / peak : 0);
  }
  const end = cash + qty * (asset === "CASH" ? 0 : by[asset].get(dates.at(-1)!)?.c ?? 0);
  const spy0 = by.SPY.get(dates.find((d) => d >= scoreFrom) ?? dates[80])!.c;
  const spy1 = by.SPY.get(dates.at(-1)!)!.c;
  const result = finish("etf-defensive-rs-v1", trades, wins, end, 100000, gw, gl, maxDd, spy1 / spy0 - 1, 12);
  const closed = detail.reduce((s, t) => s + (t.realizedPnl ?? 0), 0);
  const unrealized = open ? qty * (by[asset].get(dates.at(-1)!)?.c ?? 0) - qty * open.entryPrice : 0;
  return { ...result, tradesDetail: detail, priceOnly: true, equityReconciled: Math.abs((100000 + closed + unrealized) - end) < 1 };
}
