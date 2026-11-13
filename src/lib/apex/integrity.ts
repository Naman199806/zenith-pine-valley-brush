/** Research-tape checks. These do not score a strategy and cannot submit an order. */

export interface TapeBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface SplitEvent {
  exDate: string | null;
  numerator: number;
  denominator: number;
}

export interface DividendStamp {
  exDate: string | null;
  amount: number;
}

export interface AdjPrint {
  date: string;
  adj: number;
}

export interface ResearchPayload {
  strategyId: string;
  scored: boolean;
  frozen: boolean;
  dividendsHaveExTimestamp: boolean;
  adjustedCloseUsedAsPrice: boolean;
  historyComplete: boolean;
  corporateActionsConsistent: boolean;
  calendarsAligned: boolean;
}

export function duplicateDates(bars: TapeBar[]): string[] {
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const bar of bars) {
    if (seen.has(bar.date)) dupes.push(bar.date);
    seen.add(bar.date);
  }
  return dupes;
}

export function missingSymbols(required: string[], present: string[]): string[] {
  const have = new Set(present);
  return required.filter((symbol) => !have.has(symbol));
}

/** Dates present on the reference calendar and absent from the other tape. */
export function missingSessions(reference: string[], other: string[]): string[] {
  const have = new Set(other);
  return reference.filter((date) => !have.has(date));
}

export function badSplits(splits: SplitEvent[]): string[] {
  const reasons: string[] = [];
  for (const split of splits) {
    if (!split.exDate) reasons.push("split missing ex-date");
    if (!(split.numerator > 0) || !(split.denominator > 0)) reasons.push("split ratio not positive");
  }
  return reasons;
}

export function dividendsMissingEx(divs: DividendStamp[]): number {
  return divs.filter((div) => !div.exDate).length;
}

/** Same date, different adjusted close, across two vendor vintages. */
export function revisedAdjustedClose(earlier: AdjPrint[], later: AdjPrint[]): string[] {
  const prior = new Map(earlier.map((row) => [row.date, row.adj]));
  const dates: string[] = [];
  for (const row of later) {
    const before = prior.get(row.date);
    if (before !== undefined && before !== row.adj) dates.push(row.date);
  }
  return dates;
}

/** Reasons a research blob must not become an order. Empty only if every gate is clean and the strategy is not sprint 3. */
export function researchPayloadBlocks(payload: ResearchPayload): string[] {
  const reasons: string[] = [];
  if (payload.strategyId === "t1-tsmom" || payload.strategyId === "t2-overnight") {
    reasons.push("Sprint 3 is still IDEA and cannot be ordered.");
  }
  if (payload.scored) reasons.push("A scored result is not an order.");
  if (!payload.frozen) reasons.push("Protocol is not frozen.");
  if (!payload.dividendsHaveExTimestamp) reasons.push("A dividend has no ex-timestamp.");
  if (payload.adjustedCloseUsedAsPrice) reasons.push("Adjusted close was used as a price.");
  if (!payload.historyComplete) reasons.push("History is missing.");
  if (!payload.corporateActionsConsistent) reasons.push("Corporate actions are inconsistent.");
  if (!payload.calendarsAligned) reasons.push("Calendars are misaligned.");
  if (!reasons.length && payload.strategyId !== "paper-mechanics") {
    reasons.push("Only plumbing can reach the simulator, and this blob is not plumbing.");
  }
  return reasons;
}
