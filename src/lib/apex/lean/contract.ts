/**
 * Typed boundary for a future QuantConnect LEAN process.
 * This module does not import, spawn, or execute LEAN.
 * The Apex ledger and risk engine stay the source of truth.
 */

export const LEAN_PIN = {
  repo: "https://github.com/QuantConnect/Lean",
  branch: "master",
  /** Pinned engine commit. Not the 2017 release tag. */
  sha: "655ac6d475ad8539ff54583a26327e63b59c5703",
  committedAt: "2026-11-11T23:36:44Z",
  subject: "Rank GreenblattMagicFormulaAlpha stocks by combined factor rank (#10083)",
  parentSha: "1b4d818e3e92588dbc21e9fc9610a2dfb77c2c37",
  htmlUrl: "https://github.com/QuantConnect/Lean/commit/655ac6d475ad8539ff54583a26327e63b59c5703",
  license: "Apache-2.0",
  copyright: "Copyright 2014 QuantConnect Corporation",
  targetFramework: "net10.0",
  /** Newest GitHub Release. It does not point at `sha`. */
  latestReleaseTag: "v2.4.0.1",
  latestReleasePublishedAt: "2017-08-08T20:57:57Z",
  latestReleaseCommit: "64cf1ff870bd8670cb9a3c301258f597f51a9d8c",
} as const;

/** The TypeScript module does not spawn LEAN. A sidecar result is a separate process. */
export const LEAN_EXECUTION = {
  status: "SIDECAR",
  reason: "typescript-module-does-not-spawn-lean",
  ran: false,
} as const;

export const FILL_RULE_NEXT_BAR_OPEN = "next bar open" as const;

export type FillRule = typeof FILL_RULE_NEXT_BAR_OPEN;

/** Synthetic research bar. Prices are integer cents per share, not a market print. */
export interface ResearchBar {
  ts: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * What Apex would hand a future LEAN sidecar.
 * `placeOrders` is fixed false: LEAN must not place orders.
 */
export interface LeanResearchInput {
  strategyId: string;
  version: string;
  instrumentIds: readonly string[];
  bars: readonly ResearchBar[];
  /** Cost in basis points charged on each fill notional. */
  costBps: number;
  fillRule: FillRule;
  placeOrders: false;
}

export interface RoundTrip {
  signalBar: number;
  fillBar: number;
  /** Next bar's open, in cents per share. */
  fillPriceCents: number;
  exitSignalBar: number;
  exitFillBar: number;
  exitPriceCents: number;
  qty: number;
  grossPnlCents: number;
  feeCents: number;
  netPnlCents: number;
}

interface ResearchResultBase {
  strategyId: string;
  version: string;
  instrumentIds: readonly string[];
  tradeCount: number;
  /** Integer cents. Not a rate of return and not a market result. */
  netPnlCents: number;
  costBps: number;
  fillRule: FillRule;
  trades: readonly RoundTrip[];
  ordersPlaced: 0;
  sourceOfTruth: "apex-ledger";
}

/** Local stand-in. Not a LEAN backtest. */
export interface FixtureNotLeanResult extends ResearchResultBase {
  engine: "fixture-not-lean";
  leanProcessRan: false;
}

/**
 * Shape a future LEAN process would have to return.
 * Nothing in this tree can construct it while execution is BLOCKED.
 */
export interface LeanEngineResult extends ResearchResultBase {
  engine: "lean";
  leanProcessRan: true;
  pinSha: typeof LEAN_PIN.sha;
}

export type ResearchResult = FixtureNotLeanResult | LeanEngineResult;

export function assertEngineLabel(label: {
  engine: string;
  leanProcessRan: boolean;
  processPid?: number;
  pinSha?: string;
  brokerOrders?: boolean;
}): void {
  if (label.engine === "lean") {
    const pid = label.processPid;
    if (label.leanProcessRan !== true || pid === undefined || !Number.isInteger(pid) || pid <= 0) {
      throw new Error('refusing engine "lean" without a LEAN process');
    }
    if (label.pinSha !== LEAN_PIN.sha) {
      throw new Error("LEAN pin mismatch");
    }
    if (label.brokerOrders !== false) {
      throw new Error("LEAN must not place broker orders");
    }
    return;
  }
  if (label.engine !== "fixture-not-lean") {
    throw new Error(`unknown engine: ${label.engine}`);
  }
  if (label.leanProcessRan !== false) {
    throw new Error('fixture-not-lean cannot claim a LEAN process ran');
  }
}
