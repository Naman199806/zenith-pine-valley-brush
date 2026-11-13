/** Future backtest rules. Does not change recorded baselines. */

export interface Bar {
  date: string;
  open: number;
  close: number;
}

export interface FillSpec {
  signalOn: "completed-close";
  fillOn: "next-open";
  feeBps: number;
  spreadBps: number;
  slippageBps: number;
}

export function nextOpenFill(bars: Bar[], signalIndex: number, spec: FillSpec): { price: number; date: string } | null {
  const next = bars[signalIndex + 1];
  if (!next) return null;
  const drag = (spec.feeBps + spec.spreadBps + spec.slippageBps) / 10_000;
  return { date: next.date, price: next.open * (1 + drag) };
}

export function noLookahead(signalIndex: number, usedIndex: number): boolean {
  return usedIndex <= signalIndex;
}
