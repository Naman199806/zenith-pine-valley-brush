import { buy, sell, type CostSpec } from "./costs.ts";

export interface EtfBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface RotationTrade {
  entryDate: string;
  exitDate: string;
  symbol: string;
  entry: number;
  exit: number;
  qty: number;
  net: number;
  fees: number;
  period: "development" | "validation";
}

export interface RotationReport {
  strategy: string;
  bars: number;
  trades: RotationTrade[];
  netReturn: number;
  maxDrawdown: number;
  profitFactor: number;
  expectancy: number;
  winRate: number;
  sharpe: number;
  exposure: number;
  turnover: number;
  feesPaid: number;
  spyBuyAndHold: number;
  equalWeightBuyAndHold: number;
  cash: number;
}

export function align(series: Record<string, EtfBar[]>, symbols: string[]): EtfBar[][] {
  const maps = Object.fromEntries(symbols.map((s) => [s, new Map(series[s].map((b) => [b.date, b]))]));
  const dates = series[symbols[0]].map((b) => b.date).filter((d) => symbols.every((s) => maps[s].has(d))).sort();
  return dates.map((d) => symbols.map((s) => maps[s].get(d)!));
}

export function runRelativeStrength(
  series: Record<string, EtfBar[]>,
  symbols: string[],
  splitAt: number,
  commissionBps = 5,
  slippageBps = 1,
): RotationReport {
  const rows = align(series, symbols);
  const spec: CostSpec = { commissionBps, slippageBps };
  const lookback = 60;
  const rebalance = 20;
  let cash = 100_000;
  let qty = 0;
  let held = -1;
  let entry = 0;
  let entryCommission = 0;
  let entryDate = "";
  let peak = cash;
  let maxDd = 0;
  let fees = 0;
  let exposed = 0;
  const trades: RotationTrade[] = [];
  const equity: number[] = [];

  for (let i = lookback; i < rows.length - 1; i += rebalance) {
    const ranked = symbols
      .map((symbol, idx) => ({
        idx,
        symbol,
        ret: rows[i][idx].close / rows[i - lookback][idx].close - 1,
      }))
      .filter((r) => r.ret > 0)
      .sort((a, b) => b.ret - a.ret);
    const target = ranked[0]?.idx ?? -1;
    if (target !== held) {
      if (held >= 0) {
        const fill = sell(rows[i + 1][held].open, qty, spec);
        cash -= fill.cashOutflow;
        fees += fill.commission;
        trades.push({
          entryDate,
          exitDate: rows[i + 1][held].date,
          symbol: symbols[held],
          entry,
          exit: fill.execution,
          qty,
          net: -fill.cashOutflow - qty * entry - entryCommission,
          fees: entryCommission + fill.commission,
          period: i < splitAt ? "development" : "validation",
        });
        qty = 0;
        held = -1;
      }
      if (target >= 0) {
        const probe = buy(rows[i + 1][target].open, 1, spec);
        qty = (cash * 0.95) / probe.cashOutflow;
        const fill = buy(rows[i + 1][target].open, qty, spec);
        cash -= fill.cashOutflow;
        fees += fill.commission;
        entry = fill.execution;
        entryCommission = fill.commission;
        entryDate = rows[i + 1][target].date;
        held = target;
      }
    }
    const mark = held >= 0 ? qty * rows[i][held].close : 0;
    const eq = cash + mark;
    peak = Math.max(peak, eq);
    maxDd = Math.max(maxDd, (peak - eq) / peak);
    if (held >= 0) exposed += rebalance;
    equity.push(eq);
  }

  if (held >= 0) {
    const last = rows[rows.length - 1][held];
    const fill = sell(last.close, qty, spec);
    cash -= fill.cashOutflow;
    fees += fill.commission;
    trades.push({
      entryDate,
      exitDate: last.date,
      symbol: symbols[held],
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
  const spy = rows[rows.length - 1][0].close / rows[0][0].close - 1;
  const ew = symbols.reduce((a, _, idx) => a + rows[rows.length - 1][idx].close / rows[0][idx].close, 0) / symbols.length - 1;
  return {
    strategy: "etf-xs-rs-60-v1",
    bars: rows.length,
    trades,
    netReturn: end / 100_000 - 1,
    maxDrawdown: maxDd,
    profitFactor: grossLoss === 0 ? 0 : grossWin / grossLoss,
    expectancy: trades.length ? trades.reduce((a, t) => a + t.net, 0) / trades.length : 0,
    winRate: trades.length ? wins.length / trades.length : 0,
    sharpe: sd === 0 ? 0 : (mean / sd) * Math.sqrt(252 / rebalance),
    exposure: exposed / Math.max(1, rows.length - lookback),
    turnover: trades.length,
    feesPaid: fees,
    spyBuyAndHold: spy,
    equalWeightBuyAndHold: ew,
    cash: 0,
  };
}
