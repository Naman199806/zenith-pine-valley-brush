/** Completed daily bars only. Compare UTC dates. Do not use a raw Unix cutoff. */

export function completedBars<T extends { ts: number }>(bars: T[], asOfDate = "2026-11-13"): T[] {
  return bars.filter((bar) => new Date(bar.ts * 1000).toISOString().slice(0, 10) < asOfDate);
}
