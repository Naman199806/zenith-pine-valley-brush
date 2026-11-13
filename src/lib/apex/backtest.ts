import { bpsOf, mulDiv } from "./money.ts";

export interface Bar {
  ts: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Trade {
  day: number;
  signalBar: number;
  fillBar: number;
  fillPriceCents: number;
  exitBar: number;
  exitPriceCents: number;
  qty: number;
  grossCents: number;
  feeCents: number;
  netCents: number;
}

export interface Perf {
  netReturn: number;
  annualizedReturn: number;
  sharpe: number;
  sortino: number;
  maxDrawdown: number;
  calmar: number;
  profitFactor: number;
  winRate: number;
  avgGain: number;
  avgLoss: number;
  expectancy: number;
  expectancyR: number;
  cvar5: number;
  turnover: number;
  trades: number;
  costBpsPerSide: number;
  grossReturn: number;
  independentDays: number;
}

export interface BacktestResult {
  id: string;
  dataset: string;
  label: string;
  seed: number | null;
  constructed: boolean;
  startingCents: number;
  endingCents: number;
  costBpsPerSide: number;
  trades: Trade[];
  equity: { t: string; equityCents: number }[];
  dailyReturns: number[];
  metrics: Perf;
  folds: { name: string; netReturn: number; trades: number }[];
  lookaheadSafe: boolean;
  notes: string[];
}

export interface Quarantine {
  index: number;
  reason: string;
}

/** Point-in-time corporate actions. A split with a future ex-date must not change bars as of an earlier timestamp. */
export function applySplits(bars: Bar[], splits: { exTs: string; numerator: number; denominator: number }[], asOfTs: string): Bar[] {
  return bars.map((bar) => {
    let scale = 1;
    for (const split of splits) {
      if (split.exTs <= asOfTs && bar.ts < split.exTs) scale *= split.denominator / split.numerator;
    }
    if (scale === 1) return bar;
    return {
      ...bar,
      open: Math.round(bar.open * scale),
      high: Math.round(bar.high * scale),
      low: Math.round(bar.low * scale),
      close: Math.round(bar.close * scale),
    };
  });
}

export function validateBars(bars: Bar[]): { ok: Bar[]; quarantine: Quarantine[] } {
  const ok: Bar[] = [];
  const quarantine: Quarantine[] = [];
  let lastTs = "";
  const seen = new Set<string>();
  bars.forEach((bar, index) => {
    const reasons: string[] = [];
    if (seen.has(bar.ts)) reasons.push("duplicate timestamp");
    if (lastTs && bar.ts < lastTs) reasons.push("out of order");
    if (!(bar.high >= bar.low && bar.high >= bar.open && bar.high >= bar.close && bar.low <= bar.open && bar.low <= bar.close)) {
      reasons.push("impossible price");
    }
    if (bar.volume < 0 || !Number.isFinite(bar.volume)) reasons.push("invalid volume");
    if (bar.open <= 0 || bar.close <= 0) reasons.push("non-positive price");
    if (reasons.length) quarantine.push({ index, reason: reasons.join(", ") });
    else {
      ok.push(bar);
      seen.add(bar.ts);
      lastTs = bar.ts;
    }
  });
  return { ok, quarantine };
}

export function orbTarget(bars: Bar[], position: number): number {
  if (bars.length < 7) return position;
  const orHigh = Math.max(...bars.slice(0, 6).map((b) => b.high));
  const i = bars.length - 1;
  if (position === 0 && bars[i]!.high > orHigh && i >= 6 && i < 8) return 100;
  if (position > 0 && i >= 8) return 0;
  return position;
}

function illustrativeDay(day: number, corruptFromBar?: number, delta?: number): Bar[] {
  const rows: [number, number, number, number][] = [
    [10000, 10008, 9992, 10004],
    [10004, 10010, 9994, 10002],
    [10002, 10009, 9995, 10006],
    [10006, 10010, 9998, 10001],
    [10001, 10007, 9993, 10000],
    [10000, 10010, 9996, 10005],
    [10005, 10030, 10004, 10020],
    [10020, 10022, 10018, 10021],
    [10021, 10024, 10019, 10023],
    [10024, 10028, 10022, 10026],
  ];
  return rows.map((row, i) => {
    const shift = corruptFromBar !== undefined && delta !== undefined && i >= corruptFromBar ? delta : 0;
    const [open, high, low, close] = row;
    return {
      ts: `2024-01-${String((day % 27) + 1).padStart(2, "0")}T${String(14 + Math.floor(i / 2)).padStart(2, "0")}:${i % 2 === 0 ? "00" : "30"}:00.000Z`,
      open: open! + shift,
      high: high! + shift,
      low: low! + shift,
      close: close! + shift,
      volume: 10_000,
    };
  });
}

export function runPath(
  days: Bar[][],
  costBpsPerSide: number,
  meta: Omit<BacktestResult, "trades" | "equity" | "dailyReturns" | "metrics" | "folds" | "endingCents" | "startingCents" | "costBpsPerSide" | "lookaheadSafe"> & {
    startingCents?: number;
  },
): BacktestResult {
  const starting = meta.startingCents ?? 10_000_000;
  let cash = starting;
  const trades: Trade[] = [];
  const equity: { t: string; equityCents: number }[] = [];
  const dailyReturns: number[] = [];
  days.forEach((bars, day) => {
    const checked = validateBars(bars);
    if (checked.quarantine.length) throw new Error(checked.quarantine.map((q) => q.reason).join("; "));
    let qty = 0;
    let entry = 0;
    let signalBar = -1;
    let fillBar = -1;
    const startCash = cash;
    for (let i = 0; i < bars.length - 1; i++) {
      const seen = bars.slice(0, i + 1);
      const target = orbTarget(seen, qty);
      if (target === qty) continue;
      const next = bars[i + 1]!;
      const delta = target - qty;
      const price = next.open;
      const notion = Math.abs(delta) * price;
      const fee = bpsOf(notion, costBpsPerSide);
      if (delta > 0) {
        cash -= notion + fee;
        entry = price;
        signalBar = i;
        fillBar = i + 1;
        qty = target;
      } else {
        const gross = (price - entry) * qty;
        cash += Math.abs(delta) * price - fee;
        trades.push({
          day,
          signalBar,
          fillBar,
          fillPriceCents: entry,
          exitBar: i + 1,
          exitPriceCents: price,
          qty,
          grossCents: gross,
          feeCents: fee + bpsOf(qty * entry, costBpsPerSide),
          netCents: gross - fee - bpsOf(qty * entry, costBpsPerSide),
          });
        qty = 0;
      }
    }
    if (qty !== 0) throw new Error("position left open at day end — exit was not filled");
    equity.push({ t: bars[bars.length - 1]!.ts, equityCents: cash });
    dailyReturns.push((cash - startCash) / starting);
  });
  const folds = [0, 1, 2].map((f) => {
    const slice = trades.filter((t) => t.day >= f * (days.length / 3) && t.day < (f + 1) * (days.length / 3));
    const pnl = slice.reduce((s, t) => s + t.netCents, 0);
    return { name: `fold ${f + 1}`, netReturn: pnl / starting, trades: slice.length };
  });
  const metrics = metricsFrom(starting, cash, trades, dailyReturns, costBpsPerSide);
  return {
    id: meta.id,
    dataset: meta.dataset,
    label: meta.label,
    seed: meta.seed,
    constructed: meta.constructed,
    startingCents: starting,
    endingCents: cash,
    costBpsPerSide,
    trades,
    equity,
    dailyReturns,
    metrics,
    folds,
    lookaheadSafe: trades.every((t) => t.fillBar > t.signalBar && t.exitBar > t.fillBar),
    notes: meta.notes,
  };
}

function metricsFrom(start: number, end: number, trades: Trade[], daily: number[], costBpsPerSide: number): Perf {
  const netReturn = (end - start) / start;
  const gross = trades.reduce((s, t) => s + t.grossCents, 0) / start;
  const n = daily.length;
  const mean = n ? daily.reduce((s, x) => s + x, 0) / n : 0;
  const variance = n > 1 ? daily.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1) : 0;
  const std = Math.sqrt(variance);
  const downside = daily.filter((x) => x < 0);
  const dvar = downside.length > 1 ? downside.reduce((s, x) => s + x * x, 0) / (downside.length - 1) : 0;
  const dstd = Math.sqrt(dvar);
  const sharpe = std === 0 ? (mean === 0 ? 0 : mean > 0 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY) : (mean / std) * Math.sqrt(252);
  const sortino = dstd === 0 ? (mean === 0 ? 0 : mean > 0 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY) : (mean / dstd) * Math.sqrt(252);
  let peak = start;
  let maxDd = 0;
  let equity = start;
  // rebuild from daily pnl in cents
  let cursor = start;
  for (const r of daily) {
    cursor += Math.round(r * start);
    peak = Math.max(peak, cursor);
    maxDd = Math.max(maxDd, peak > 0 ? (peak - cursor) / peak : 0);
    equity = cursor;
  }
  void equity;
  const years = n / 252;
  const annualized = years > 0 ? (1 + netReturn) ** (1 / years) - 1 : netReturn;
  const wins = trades.filter((t) => t.netCents > 0);
  const losses = trades.filter((t) => t.netCents < 0);
  const gain = wins.reduce((s, t) => s + t.netCents, 0);
  const loss = losses.reduce((s, t) => s + t.netCents, 0);
  const sorted = [...daily].sort((a, b) => a - b);
  const tailN = Math.max(1, Math.floor(sorted.length * 0.05));
  const cvar = sorted.slice(0, tailN).reduce((s, x) => s + x, 0) / tailN;
  const avgLossAbs = losses.length ? Math.abs(loss) / losses.length : 0;
  const expectancy = trades.length ? trades.reduce((s, t) => s + t.netCents, 0) / trades.length : 0;
  const turnover = trades.reduce((s, t) => s + Math.abs(t.qty * t.fillPriceCents) + Math.abs(t.qty * t.exitPriceCents), 0) / start;
  return {
    netReturn,
    annualizedReturn: annualized,
    sharpe,
    sortino,
    maxDrawdown: maxDd,
    calmar: maxDd === 0 ? (netReturn === 0 ? 0 : Number.POSITIVE_INFINITY) : annualized / maxDd,
    profitFactor: loss === 0 ? (gain === 0 ? 0 : Number.POSITIVE_INFINITY) : gain / Math.abs(loss),
    winRate: trades.length ? wins.length / trades.length : 0,
    avgGain: wins.length ? gain / wins.length : 0,
    avgLoss: losses.length ? loss / losses.length : 0,
    expectancy,
    expectancyR: avgLossAbs === 0 ? Number.NaN : expectancy / avgLossAbs,
    cvar5: cvar,
    turnover,
    trades: trades.length,
    costBpsPerSide,
    grossReturn: gross,
    independentDays: n,
  };
}

export function runIllustrativeOrb(costBpsPerSide: number, corrupt?: { fromBar: number; delta: number }): BacktestResult {
  const days = Array.from({ length: 40 }, (_, d) => illustrativeDay(d, corrupt?.fromBar, corrupt?.delta));
  return runPath(days, costBpsPerSide, {
    id: `orb-illustrative-${costBpsPerSide}`,
    dataset: "ILLUSTRATIVE_COST_DRAG_V1",
    label: "Constructed opening-range path. Every session is identical. Not a market sample.",
    seed: null,
    constructed: true,
    notes: [
      "Gross continuation is 4 cents a share, filled at the next open.",
      "8 bps per side is larger than that continuation, so net expectancy is negative by construction.",
      "Variance is zero. Sharpe is not a promotion input.",
      "Do not retune the path to flip the sign.",
    ],
  });
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Seeded noise. Reported as-is. A lucky sign is still not evidence. */
export function runNoiseWalk(costBpsPerSide: number, seed = 20261111): BacktestResult {
  const rng = mulberry32(seed);
  const days: Bar[][] = [];
  for (let d = 0; d < 60; d++) {
    let px = 10_000;
    const bars: Bar[] = [];
    for (let i = 0; i < 10; i++) {
      const open = px;
      const shock = Math.round(gauss(rng) * 12);
      const close = Math.max(100, open + shock);
      const high = Math.max(open, close) + Math.abs(Math.round(gauss(rng) * 4));
      const low = Math.min(open, close) - Math.abs(Math.round(gauss(rng) * 4));
      bars.push({
        ts: `2025-06-${String((d % 27) + 1).padStart(2, "0")}T${String(14).padStart(2, "0")}:${String(i).padStart(2, "0")}:00.000Z`,
        open,
        high,
        low,
        close,
        volume: 1_000,
      });
      px = close;
    }
    days.push(bars);
  }
  return runPath(days, costBpsPerSide, {
    id: `orb-noise-${seed}-${costBpsPerSide}`,
    dataset: "SYNTHETIC_NOISE_V1",
    label: "Seeded random walk. Not a market. Sign does not matter for promotion.",
    seed,
    constructed: true,
    notes: ["Same opening-range rule as the cost control.", "Synthetic data cannot be promoted."],
  });
}

export function doubledCostWorse(base: BacktestResult, doubled: BacktestResult): boolean {
  return doubled.endingCents < base.endingCents;
}

export function grossBeatsNet(zero: BacktestResult, withCost: BacktestResult): boolean {
  return zero.metrics.grossReturn >= withCost.metrics.netReturn && zero.endingCents > withCost.endingCents;
}

export const CONTROL = {
  zero: runIllustrativeOrb(0),
  base: runIllustrativeOrb(8),
  stress: runIllustrativeOrb(16),
};
