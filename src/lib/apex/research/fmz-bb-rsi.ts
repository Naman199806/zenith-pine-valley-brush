export interface Bar {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
}

export interface FmzSignal {
  strategy: "fmz-bb-rsi-long-v1.2-adapted";
  signal: "BUY" | "EXIT" | "WAIT";
  rsi: number | null;
  prevRsi: number | null;
  basis: number | null;
  upper: number | null;
  lower: number | null;
  atr14: number | null;
  close: number | null;
  barTime: string | null;
  barsUsed: number;
  reason: string;
}

function sma(values: number[], n: number): number | null {
  if (values.length < n) return null;
  const slice = values.slice(-n);
  return slice.reduce((a, b) => a + b, 0) / n;
}

function stdev(values: number[], n: number): number | null {
  const mean = sma(values, n);
  if (mean == null) return null;
  const slice = values.slice(-n);
  const v = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  return Math.sqrt(v);
}

function rsi(values: number[], n: number): number | null {
  if (values.length < n + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = values.length - n; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  if (loss === 0) return 100;
  const rs = gain / loss;
  return 100 - 100 / (1 + rs);
}

function wilderAtr(bars: Bar[], n = 14): number | null {
  if (bars.length < n + 1) return null;
  const trs: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1].c;
    const b = bars[i];
    trs.push(Math.max(b.h - b.l, Math.abs(b.h - prev), Math.abs(b.l - prev)));
  }
  let atr = trs.slice(0, n).reduce((a, b) => a + b, 0) / n;
  for (const tr of trs.slice(n)) atr = (atr * (n - 1) + tr) / n;
  return atr;
}

export function completedBars(bars: Bar[], nowMs = Date.now(), timeframeMs = 15 * 60 * 1000): Bar[] {
  return bars.filter((b) => {
    const start = Date.parse(b.t);
    return Number.isFinite(start) && start + timeframeMs <= nowMs;
  });
}

export function evaluateFmz(bars: Bar[], minBars = 250, nowMs = Date.now()): FmzSignal {
  const usable = completedBars(bars, nowMs);
  const base = {
    strategy: "fmz-bb-rsi-long-v1.2-adapted" as const,
    rsi: null, prevRsi: null, basis: null, upper: null, lower: null, atr14: null,
    close: usable.at(-1)?.c ?? null, barTime: usable.at(-1)?.t ?? null, barsUsed: usable.length,
  };
  if (usable.length < minBars) return { ...base, signal: "WAIT", reason: `need ${minBars} completed bars, have ${usable.length}` };
  const closes = usable.map((b) => b.c);
  const prev = closes.slice(0, -1);
  const r = rsi(closes, 6);
  const pr = rsi(prev, 6);
  const basis = sma(closes, 200);
  const dev = stdev(closes, 200);
  const upper = basis != null && dev != null ? basis + 2 * dev : null;
  const lower = basis != null && dev != null ? basis - 2 * dev : null;
  const atr14 = wilderAtr(usable, 14);
  const c = closes.at(-1)!;
  const pc = closes.at(-2)!;
  const long = r != null && pr != null && lower != null && pr <= 50 && r > 50 && pc <= lower && c > lower;
  const exit = r != null && pr != null && upper != null && pr >= 50 && r < 50 && pc >= upper && c < upper;
  return {
    ...base,
    rsi: r, prevRsi: pr, basis, upper, lower, atr14,
    signal: long ? "BUY" : exit ? "EXIT" : "WAIT",
    reason: long ? "RSI crossed above 50 and close crossed above lower band" : exit ? "RSI crossed below 50 and close crossed below upper band" : "no simultaneous cross",
  };
}
