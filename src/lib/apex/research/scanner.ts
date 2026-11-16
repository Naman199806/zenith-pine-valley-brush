/**
 * Research scanner. Ranks the universe. Does not submit.
 */

import type { Bar } from "./canonical-decision.ts";
import { computeVectorSignal } from "./canonical-decision.ts";

export interface ScanResult {
  symbol: string;
  signal: "BUY" | "EXIT" | "WAIT";
  last: number;
  rank60: number | null;
}

export function scanUniverse(universe: Record<string, Bar[]>, spy: Bar[]): ScanResult[] {
  return Object.keys(universe).map((symbol) => {
    const bars = universe[symbol]!;
    const last = bars.at(-1)?.close ?? 0;
    const rank60 = bars.length >= 61 ? last / bars[bars.length - 61]!.close - 1 : null;
    return { symbol, signal: computeVectorSignal(symbol, bars, spy, universe), last, rank60 };
  }).sort((a, b) => (b.rank60 ?? -Infinity) - (a.rank60 ?? -Infinity));
}
