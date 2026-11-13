/**
 * Deterministic 3-bar fill check. This is not LEAN and does not start a process.
 * Prices are synthetic cents. The net figure is an accounting identity, not a market return.
 *
 * Bars (cents per share):
 *   0  2024-01-02T14:30:00.000Z  open 10000  high 10100  low 9900  close 10050  vol 1000
 *   1  2024-01-02T15:00:00.000Z  open 10080  high 10200  low 10040 close 10150  vol 1100
 *   2  2024-01-02T15:30:00.000Z  open 10120  high 10180  low 10090 close 10100  vol 900
 *
 * Rule: if bar 0 close > bar 0 open, buy 100 shares at bar 1 open and sell them at bar 2 open.
 * Cost: 10 bps of fill notional each side, exact integer cents.
 *   entry 10080 * 100 = 1_008_000; fee 1_008
 *   exit  10120 * 100 = 1_012_000; fee 1_012
 *   gross (10120 - 10080) * 100 = 4_000
 *   net 4_000 - 1_008 - 1_012 = 1_980 cents
 * One round trip. Engine label is "fixture-not-lean".
 */
import { assertEngineLabel, FILL_RULE_NEXT_BAR_OPEN, type FixtureNotLeanResult, type LeanResearchInput, type RoundTrip } from "./contract.ts";

export const FIXTURE_STRATEGY_ID = "fixture-long-if-up";
export const FIXTURE_VERSION = "fixture-1";
export const FIXTURE_INSTRUMENT_IDS = ["FIXTURE"] as const;
export const FIXTURE_COST_BPS = 10;
export const FIXTURE_QTY = 100;

export const FIXTURE_BARS = [
  { ts: "2024-01-02T14:30:00.000Z", open: 10_000, high: 10_100, low: 9_900, close: 10_050, volume: 1_000 },
  { ts: "2024-01-02T15:00:00.000Z", open: 10_080, high: 10_200, low: 10_040, close: 10_150, volume: 1_100 },
  { ts: "2024-01-02T15:30:00.000Z", open: 10_120, high: 10_180, low: 10_090, close: 10_100, volume: 900 },
] as const;

export const FIXTURE_INPUT: LeanResearchInput = {
  strategyId: FIXTURE_STRATEGY_ID,
  version: FIXTURE_VERSION,
  instrumentIds: FIXTURE_INSTRUMENT_IDS,
  bars: FIXTURE_BARS,
  costBps: FIXTURE_COST_BPS,
  fillRule: FILL_RULE_NEXT_BAR_OPEN,
  placeOrders: false,
};

function sideFeeCents(notionalCents: number, costBps: number): number {
  if (!Number.isInteger(notionalCents) || !Number.isInteger(costBps) || costBps < 0) {
    throw new Error("cost bps and notional must be integers");
  }
  const product = notionalCents * costBps;
  if (product % 10_000 !== 0) {
    throw new Error("fixture cost is not an exact integer number of cents");
  }
  return product / 10_000;
}

/** Run the documented fixture. Never labels the result as LEAN. */
export function runFixtureNotLean(input: LeanResearchInput = FIXTURE_INPUT): FixtureNotLeanResult {
  if (input.placeOrders !== false) {
    throw new Error("LEAN must not place orders; Apex ledger is the source of truth");
  }
  if (input.fillRule !== FILL_RULE_NEXT_BAR_OPEN) {
    throw new Error(`unsupported fill rule: ${input.fillRule}`);
  }
  if (input.bars.length !== 3) {
    throw new Error("fixture smoke requires exactly 3 bars");
  }
  if (input.instrumentIds.length !== 1) {
    throw new Error("fixture smoke is one instrument");
  }
  const bar0 = input.bars[0];
  const bar1 = input.bars[1];
  const bar2 = input.bars[2];
  if (!bar0 || !bar1 || !bar2) {
    throw new Error("missing bar");
  }

  const trades: RoundTrip[] = [];
  if (bar0.close > bar0.open) {
    const entry = bar1.open;
    const exit = bar2.open;
    const grossPnlCents = (exit - entry) * FIXTURE_QTY;
    const feeCents = sideFeeCents(entry * FIXTURE_QTY, input.costBps) + sideFeeCents(exit * FIXTURE_QTY, input.costBps);
    trades.push({
      signalBar: 0,
      fillBar: 1,
      fillPriceCents: entry,
      exitSignalBar: 1,
      exitFillBar: 2,
      exitPriceCents: exit,
      qty: FIXTURE_QTY,
      grossPnlCents,
      feeCents,
      netPnlCents: grossPnlCents - feeCents,
    });
  }

  const result: FixtureNotLeanResult = {
    strategyId: input.strategyId,
    version: input.version,
    instrumentIds: input.instrumentIds,
    tradeCount: trades.length,
    netPnlCents: trades.reduce((sum, trade) => sum + trade.netPnlCents, 0),
    costBps: input.costBps,
    fillRule: input.fillRule,
    trades,
    ordersPlaced: 0,
    sourceOfTruth: "apex-ledger",
    engine: "fixture-not-lean",
    leanProcessRan: false,
  };
  assertEngineLabel(result);
  return result;
}
