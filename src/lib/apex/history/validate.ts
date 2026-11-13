import type { RawBar, RawDividend, RawSplit } from "./types.ts";

export interface BarIssue {
  index: number;
  date: string;
  reason: string;
}

export function duplicateDates(dates: string[]): string[] {
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const date of dates) {
    if (seen.has(date)) dupes.push(date);
    seen.add(date);
  }
  return dupes;
}

export function barIssues(bars: RawBar[]): BarIssue[] {
  const issues: BarIssue[] = [];
  const seen = new Set<string>();
  bars.forEach((bar, index) => {
    const reasons: string[] = [];
    if (seen.has(bar.date)) reasons.push("duplicate date");
    seen.add(bar.date);
    if (!(bar.open > 0 && bar.high > 0 && bar.low > 0 && bar.close > 0)) reasons.push("non-positive price");
    if (!(bar.high >= bar.low && bar.high >= bar.open && bar.high >= bar.close && bar.low <= bar.open && bar.low <= bar.close)) {
      reasons.push("impossible ohlc");
    }
    if (!(bar.volume >= 0) || !Number.isFinite(bar.volume)) reasons.push("invalid volume");
    if (reasons.length) issues.push({ index, date: bar.date, reason: reasons.join(", ") });
  });
  return issues;
}

export function dividendsMissingEx(divs: RawDividend[]): number {
  return divs.filter((div) => !div.exTs || !div.exDate).length;
}

export function badSplits(splits: RawSplit[]): string[] {
  const reasons: string[] = [];
  for (const split of splits) {
    if (!split.exTs) reasons.push("split missing ex-timestamp");
    if (!(Number(split.numerator) > 0) || !(Number(split.denominator) > 0)) reasons.push("split ratio not positive");
  }
  return reasons;
}

/** Dates on the reference session list that the other tape does not have. */
export function missingSessions(reference: string[], other: string[]): string[] {
  const have = new Set(other);
  return reference.filter((date) => !have.has(date));
}

export interface AdjVintage {
  date: string;
  adj: number;
}

/** Same session, different adjusted close, across two downloads. That series is revised. */
export function revisedAdjustedClose(earlier: AdjVintage[], later: AdjVintage[]): string[] {
  const prior = new Map(earlier.map((row) => [row.date, row.adj]));
  const dates: string[] = [];
  for (const row of later) {
    const before = prior.get(row.date);
    if (before !== undefined && before !== row.adj) dates.push(row.date);
  }
  return dates;
}

/** True when the price used for accounting is the revised adjusted close rather than the raw close. */
export function accountingUsesAdjustedClose(close: number, adj: number | null, accountingPrice: number): boolean {
  return adj !== null && adj !== close && accountingPrice === adj;
}
