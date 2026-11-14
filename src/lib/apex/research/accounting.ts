export interface CashTrade {
  entryDate: string;
  exitDate: string;
  entry: number;
  exit: number;
  qty: number;
  net: number;
  fees: number;
}

export interface BtcReconciliation {
  trades: number;
  costEmbeddedGross: number;
  exitFees: number;
  entryFees: number;
  explicitFees: number;
  tradeLevelNet: number;
  portfolioEquityChange: number;
  identityHolds: boolean;
  rootCause: string;
  originalEngineEndEquity: number;
  correctedSingleCountEndEquity: number;
  correctedSingleCountReturn: number;
}

export function reconcileBtc(trades: CashTrade[], explicitFees: number, start = 100_000): BtcReconciliation {
  const costEmbeddedGross = trades.reduce((a, t) => a + (t.exit - t.entry) * t.qty, 0);
  const exitFees = trades.reduce((a, t) => a + t.fees, 0);
  const tradeLevelNet = trades.reduce((a, t) => a + t.net, 0);
  const entryFees = explicitFees - exitFees;
  const portfolioEquityChange = tradeLevelNet - entryFees;
  return {
    trades: trades.length,
    costEmbeddedGross: round(costEmbeddedGross),
    exitFees: round(exitFees),
    entryFees: round(entryFees),
    explicitFees: round(explicitFees),
    tradeLevelNet: round(tradeLevelNet),
    portfolioEquityChange: round(portfolioEquityChange),
    identityHolds: Math.abs(costEmbeddedGross - exitFees - tradeLevelNet) < 0.05
      && Math.abs(tradeLevelNet - entryFees - portfolioEquityChange) < 0.05,
    rootCause: "Trade-level net subtracts the exit fee only. Portfolio equity also subtracts the entry fee. The fill prices already embed the same cost, so the original engine double-counts transaction costs.",
    originalEngineEndEquity: round(start + portfolioEquityChange),
    correctedSingleCountEndEquity: round(start + costEmbeddedGross),
    correctedSingleCountReturn: round(costEmbeddedGross / start),
  };
}

export function metrics(equity: number[], periodsPerYear: number) {
  const start = equity[0];
  const end = equity[equity.length - 1];
  const years = (equity.length - 1) / periodsPerYear;
  const rets = equity.slice(1).map((v, i) => v / equity[i] - 1);
  const mean = rets.reduce((a, b) => a + b, 0) / (rets.length || 1);
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length || 1);
  const sd = Math.sqrt(variance);
  const downside = Math.sqrt(rets.reduce((a, b) => a + Math.min(b, 0) ** 2, 0) / (rets.length || 1));
  let peak = start;
  let maxDd = 0;
  for (const v of equity) {
    peak = Math.max(peak, v);
    maxDd = Math.max(maxDd, (peak - v) / peak);
  }
  return {
    netReturn: round(end / start - 1),
    cagr: round((end / start) ** (1 / years) - 1),
    maxDrawdown: round(maxDd),
    volatility: round(sd * Math.sqrt(periodsPerYear)),
    sharpe: round(sd === 0 ? 0 : (mean / sd) * Math.sqrt(periodsPerYear)),
    sortino: round(downside === 0 ? 0 : (mean / downside) * Math.sqrt(periodsPerYear)),
  };
}

function round(n: number): number {
  return Number(n.toFixed(4));
}
