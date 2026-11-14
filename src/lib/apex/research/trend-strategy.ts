import { buy, sell, type CostSpec } from "./costs.ts";

export interface Candle {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Trade {
  entryDate: string;
  exitDate: string;
  entry: number;
  exit: number;
  qty: number;
  net: number;
  fees: number;
  period: "development" | "validation";
}

export interface Report {
  strategy: string;
  bars: number;
  trades: Trade[];
  netReturn: number;
  maxDrawdown: number;
  profitFactor: number;
  expectancy: number;
  winRate: number;
  sharpe: number;
  exposure: number;
  turnover: number;
  buyAndHold: number;
  cash: number;
  feesPaid: number;
}

export function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out = new Array(values.length).fill(NaN);
  if (values.length < period) return out;
  let seed = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = seed;
  for (let i = period; i < values.length; i++) {
    seed = values[i] * k + seed * (1 - k);
    out[i] = seed;
  }
  return out;
}

export function atrWilder(bars: Candle[], period = 14): number[] {
  const out = new Array(bars.length).fill(NaN);
  const tr: number[] = [bars[0].high - bars[0].low];
  for (let i = 1; i < bars.length; i++) {
    tr.push(Math.max(bars[i].high - bars[i].low, Math.abs(bars[i].high - bars[i - 1].close), Math.abs(bars[i].low - bars[i - 1].close)));
  }
  if (tr.length <= period) return out;
  let value = tr.slice(1, period + 1).reduce((a, b) => a + b, 0) / period;
  out[period] = value;
  for (let i = period + 1; i < bars.length; i++) {
    value = (value * (period - 1) + tr[i]) / period;
    out[i] = value;
  }
  return out;
}

function day(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

export function runTrend(bars: Candle[], splitAt: number, commissionBps = 25, slippageBps = 5): Report {
  const closes = bars.map((b) => b.close);
  const ema20 = ema(closes, 20);
  const ema100 = ema(closes, 100);
  const atr = atrWilder(bars, 14);
  const spec: CostSpec = { commissionBps, slippageBps };
  let cash = 100_000;
  let qty = 0;
  let entry = 0;
  let entryCommission = 0;
  let entryDate = "";
  let peak = cash;
  let maxDd = 0;
  let fees = 0;
  let exposed = 0;
  const trades: Trade[] = [];
  const equity: number[] = [];

  for (let i = 100; i < bars.length - 1; i++) {
    const longOk = ema20[i] > ema100[i] && closes[i] > ema100[i];
    if (qty === 0 && longOk && Number.isFinite(atr[i]) && atr[i] > 0) {
      const risk = cash * 0.01;
      const rawQty = risk / (2 * atr[i]);
      const probe = buy(bars[i + 1].open, 1, spec);
      const maxQty = (cash * 0.95) / probe.cashOutflow;
      qty = Math.min(rawQty, maxQty);
      const fill = buy(bars[i + 1].open, qty, spec);
      cash -= fill.cashOutflow;
      fees += fill.commission;
      entry = fill.execution;
      entryCommission = fill.commission;
      entryDate = day(bars[i + 1].ts);
    } else if (qty > 0 && !longOk) {
      const fill = sell(bars[i + 1].open, qty, spec);
      cash -= fill.cashOutflow;
      fees += fill.commission;
      trades.push({
        entryDate,
        exitDate: day(bars[i + 1].ts),
        entry,
        exit: fill.execution,
        qty,
        net: -fill.cashOutflow - qty * entry - entryCommission,
        fees: entryCommission + fill.commission,
        period: i + 1 < splitAt ? "development" : "validation",
      });
      qty = 0;
    }
    const mark = qty > 0 ? qty * bars[i].close : 0;
    const eq = cash + mark;
    peak = Math.max(peak, eq);
    maxDd = Math.max(maxDd, (peak - eq) / peak);
    if (qty > 0) exposed += 1;
    equity.push(eq);
  }

  if (qty > 0) {
    const fill = sell(bars[bars.length - 1].close, qty, spec);
    cash -= fill.cashOutflow;
    fees += fill.commission;
    trades.push({
      entryDate,
      exitDate: day(bars[bars.length - 1].ts),
      entry,
      exit: fill.execution,
      qty,
      net: -fill.cashOutflow - qty * entry - entryCommission,
      fees: entryCommission + fill.commission,
      period: "validation",
    });
  }

  const end = cash;
  const wins = trades.filter((t) => t.net > 0);
  const losses = trades.filter((t) => t.net <= 0);
  const grossWin = wins.reduce((a, t) => a + t.net, 0);
  const grossLoss = Math.abs(losses.reduce((a, t) => a + t.net, 0));
  const rets = equity.slice(1).map((v, i) => v / equity[i] - 1);
  const mean = rets.reduce((a, b) => a + b, 0) / (rets.length || 1);
  const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length || 1));
  return {
    strategy: "btc-ema20-100-v1",
    bars: bars.length,
    trades,
    netReturn: end / 100_000 - 1,
    maxDrawdown: maxDd,
    profitFactor: grossLoss === 0 ? 0 : grossWin / grossLoss,
    expectancy: trades.length ? trades.reduce((a, t) => a + t.net, 0) / trades.length : 0,
    winRate: trades.length ? wins.length / trades.length : 0,
    sharpe: sd === 0 ? 0 : (mean / sd) * Math.sqrt(365),
    exposure: exposed / Math.max(1, bars.length - 101),
    turnover: trades.length,
    buyAndHold: bars[bars.length - 1].close / bars[0].close - 1,
    cash: 0,
    feesPaid: fees,
  };
}
