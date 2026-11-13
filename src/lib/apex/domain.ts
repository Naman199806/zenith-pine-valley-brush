import { notionalCents } from "./money.ts";

export const AS_OF = "2026-11-11T21:00:00.000Z";
export const RULES_VERSION = "paper-defaults-v1";
export const STARTING_CASH_CENTS = 100_000_000;

export type AssetClass =
  | "equity"
  | "etf"
  | "crypto"
  | "fx"
  | "option"
  | "commodity"
  | "future"
  | "prediction";

export type StrategyState =
  | "IDEA"
  | "EXPERIMENT"
  | "BACKTESTED"
  | "VALIDATED"
  | "PAPER"
  | "SHADOW"
  | "LIVE_ELIGIBLE"
  | "LIVE"
  | "SUSPENDED"
  | "RETIRED";

export type OperatingMode = "RESEARCH" | "PAPER" | "LIVE";

export type OrderState =
  | "rejected"
  | "submitted"
  | "unknown"
  | "acknowledged"
  | "partially_filled"
  | "filled"
  | "cancel_requested"
  | "cancel_rejected"
  | "canceled";

export interface Instrument {
  id: string;
  symbol: string;
  name: string;
  assetClass: AssetClass;
  venueId: string;
  currency: string;
  priceDecimals: number;
  sizeDecimals: number;
  lotMicros: number;
  tickMicros: number;
  multiplier: number;
  paperEligible: boolean;
  liveEligible: false;
  leveraged: boolean;
  shortable: boolean;
  factor: string;
  session: string;
  dataLabel: "SIMULATED_FIXTURE" | "MODEL_ONLY";
  notes: string;
  contract?: {
    expiry?: string;
    exercise?: string;
    right?: string;
    strike?: string;
    payoff?: string;
    margin?: string;
    delivery?: string;
    resolutionAmbiguous?: boolean;
    productKind?: string;
  };
}

export interface Quote {
  instrumentId: string;
  bidMicros: number;
  askMicros: number;
  lastMicros: number;
  exchangeTs: string;
  providerTs: string;
  ingestedTs: string;
  source: "internal-fixture";
}

export interface StrategyDefinition {
  id: string;
  version: string;
  name: string;
  family: string;
  markets: string;
  state: StrategyState;
  hypothesis: string;
  entry: string;
  exit: string;
  horizon: string;
  costModel: string;
  failureModes: string;
  retirement: string;
  evidence: "preserved-note" | "computed-control" | "none";
  ceiling: StrategyState;
}

export interface Position {
  instrumentId: string;
  qtyMicros: number;
  avgPriceMicros: number;
  realizedCents: number;
  strategyId: string;
}

export interface Fill {
  id: string;
  qtyMicros: number;
  priceMicros: number;
  feeCents: number;
  ts: string;
  slippageNote: string;
}

export interface BrokerOrder {
  id: string;
  idempotencyKey: string;
  instrumentId: string;
  side: "buy" | "sell";
  orderType: "market" | "limit" | "stop" | "stop_limit";
  qtyMicros: number;
  filledQtyMicros: number;
  limitPriceMicros?: number;
  stopPriceMicros?: number;
  state: OrderState;
  strategyId: string;
  strategyVersion: string;
  mode: OperatingMode;
  riskDecisionId: string;
  createdTs: string;
  fills: Fill[];
  rejectReason?: string;
  ackLost?: boolean;
  live: false;
}

export interface AuditEvent {
  id: string;
  ts: string;
  actor: string;
  action: string;
  detail: string;
}

export interface KillSwitch {
  blockNew: boolean;
  cancelRequested: boolean;
  flattenRequested: boolean;
  brokerConnected: boolean;
  /** True only when the broker has confirmed a flat book. Never inferred from a cancel request. */
  positionsConfirmedFlat: boolean;
}

export interface Book {
  mode: OperatingMode;
  liveLocked: true;
  nowTs: string;
  dayStartEquityCents: number;
  peakEquityCents: number;
  cashCents: number;
  positions: Position[];
  orders: BrokerOrder[];
  audits: AuditEvent[];
  kill: KillSwitch;
  dataStatus: "fresh" | "stale" | "halted";
  reconciliation: "matched" | "broken";
  credentials: "absent" | "expired";
  restricted: string[];
  withdrawalHalt: string[];
  reviewRequired: boolean;
  lastMessage: string;
}

export interface Intent {
  idempotencyKey: string;
  instrumentId: string;
  side: "buy" | "sell";
  orderType: "market" | "limit" | "stop" | "stop_limit";
  qtyMicros: number;
  limitPriceMicros?: number;
  stopPriceMicros?: number;
  stopBps: number;
  strategyId: string;
  strategyVersion: string;
  expectedPriceMicros: number;
  evidenceIds: string[];
  actor: "user" | "agent" | "execution-service";
  newValidatedSignal: boolean;
}

export interface RiskDecision {
  id: string;
  approved: boolean;
  reasons: string[];
  adjustedQtyMicros: number;
  rulesVersion: typeof RULES_VERSION;
  advisoryOnly: false;
}

const PATH: StrategyState[] = [
  "IDEA",
  "EXPERIMENT",
  "BACKTESTED",
  "VALIDATED",
  "PAPER",
  "SHADOW",
  "LIVE_ELIGIBLE",
  "LIVE",
];

export function nextState(state: StrategyState): StrategyState | null {
  const i = PATH.indexOf(state);
  if (i < 0 || i === PATH.length - 1) return null;
  return PATH[i + 1] ?? null;
}

function q(last: number, halfSpread: number): Pick<Quote, "bidMicros" | "askMicros" | "lastMicros"> {
  return { bidMicros: last - halfSpread, askMicros: last + halfSpread, lastMicros: last };
}

function quote(id: string, last: number, halfSpread: number): Quote {
  const px = q(last, halfSpread);
  return {
    instrumentId: id,
    ...px,
    exchangeTs: AS_OF,
    providerTs: AS_OF,
    ingestedTs: AS_OF,
    source: "internal-fixture",
  };
}

export const INSTRUMENTS: Instrument[] = [
  inst("SPY", "SPDR S&P 500 ETF", "etf", "XNYS", true, false, "us-equity-beta", "US cash 09:30–16:00 America/New_York", "Reference paper instrument. ETF, not the index."),
  inst("QQQ", "Invesco QQQ", "etf", "XNAS", true, false, "us-equity-beta", "US cash 09:30–16:00 America/New_York", "Highly correlated with SPY. Correlation can reject an otherwise clean ticket."),
  inst("IWM", "iShares Russell 2000", "etf", "ARCX", true, false, "us-equity-beta", "US cash 09:30–16:00 America/New_York", "Equity beta sleeve."),
  inst("GLD", "SPDR Gold Shares", "etf", "ARCX", true, false, "gold", "US cash 09:30–16:00 America/New_York", "ETF exposure to gold. Not a futures contract and not bullion."),
  inst("TLT", "iShares 20+ Year Treasury", "etf", "XNAS", true, false, "rates", "US cash 09:30–16:00 America/New_York", "Rate-duration ETF. Not a Treasury future."),
  inst("EFA", "iShares MSCI EAFE", "etf", "ARCX", false, false, "us-equity-beta", "US cash session", "Modeled. Paper adapter not opened."),
  inst("EEM", "iShares MSCI Emerging Markets", "etf", "ARCX", false, false, "us-equity-beta", "US cash session", "Modeled. Paper adapter not opened."),
  inst("DBC", "Invesco DB Commodity Index", "etf", "ARCX", false, false, "energy", "US cash session", "Broad commodity ETF. Not crude, not a future."),
  inst("VNQ", "Vanguard Real Estate ETF", "etf", "ARCX", false, false, "us-equity-beta", "US cash session", "Modeled only."),
  inst("BIL", "SPDR 1-3 Month T-Bill", "etf", "ARCX", false, false, "cash", "US cash session", "Cash proxy for the unfrozen T1 protocol. Not scored."),
  {
    ...inst("BTC-USD", "Bitcoin spot", "crypto", "SIM-CRYPTO", false, false, "crypto-beta", "24/7 model", "Spot only. No staking, lending, or bridging."),
    dataLabel: "MODEL_ONLY",
    sizeDecimals: 6,
    lotMicros: 100,
  },
  {
    ...inst("ETH-USD", "Ether spot", "crypto", "SIM-CRYPTO", false, false, "crypto-beta", "24/7 model", "Spot model. Withdrawal halts block risk-increasing orders."),
    dataLabel: "MODEL_ONLY",
    sizeDecimals: 6,
    lotMicros: 1_000,
  },
  {
    ...inst("EURUSD", "Euro / US dollar", "fx", "SIM-FX", false, false, "usd", "London / New York overlap model", "Major pair model. Rollover and broker leverage are not enabled."),
    dataLabel: "MODEL_ONLY",
    priceDecimals: 5,
    tickMicros: 10,
  },
  {
    ...inst("USDJPY", "US dollar / yen", "fx", "SIM-FX", false, false, "usd", "Tokyo / London model", "Cross model only."),
    dataLabel: "MODEL_ONLY",
    priceDecimals: 3,
  },
  {
    id: "SPY261218C500",
    symbol: "SPY 2026-12-18 500 C",
    name: "SPY December 500 call",
    assetClass: "option",
    venueId: "OPRA-MODEL",
    currency: "USD",
    priceDecimals: 2,
    sizeDecimals: 0,
    lotMicros: 1_000_000,
    tickMicros: 10_000,
    multiplier: 100,
    paperEligible: false,
    liveEligible: false,
    leveraged: true,
    shortable: false,
    factor: "us-equity-beta",
    session: "US cash options",
    dataLabel: "MODEL_ONLY",
    notes: "Defined-risk long call model. No naked short. Greeks are not invented when no surface is loaded.",
    contract: { expiry: "2026-12-18", exercise: "american", right: "call", strike: "500", payoff: "max(S-K,0)", productKind: "listed-equity-option" },
  },
  {
    id: "MESZ26",
    symbol: "MESZ26",
    name: "Micro E-mini S&P 500 Dec 2026",
    assetClass: "future",
    venueId: "CME-MODEL",
    currency: "USD",
    priceDecimals: 2,
    sizeDecimals: 0,
    lotMicros: 1_000_000,
    tickMicros: 250_000,
    multiplier: 5,
    paperEligible: false,
    liveEligible: false,
    leveraged: true,
    shortable: false,
    factor: "us-equity-beta",
    session: "CME equity index session model",
    dataLabel: "MODEL_ONLY",
    notes: "The index is not tradable. This is the future. Initial policy blocks leveraged products. Expiry is not auto-rolled.",
    contract: { expiry: "2026-12-18", multiplierNote: "5 USD per point", margin: "initial and maintenance not funded", delivery: "cash-settled index future", productKind: "index-future" } as Instrument["contract"],
  },
  {
    id: "GCZ26",
    symbol: "GCZ26",
    name: "Gold futures Dec 2026",
    assetClass: "future",
    venueId: "COMEX-MODEL",
    currency: "USD",
    priceDecimals: 1,
    sizeDecimals: 0,
    lotMicros: 1_000_000,
    tickMicros: 100_000,
    multiplier: 100,
    paperEligible: false,
    liveEligible: false,
    leveraged: true,
    shortable: false,
    factor: "gold",
    session: "COMEX metals model",
    dataLabel: "MODEL_ONLY",
    notes: "Futures gold. Not interchangeable with GLD or bullion.",
    contract: { expiry: "2026-12-28", delivery: "physically deliverable; not enabled", productKind: "metal-future" },
  },
  {
    id: "CLZ26",
    symbol: "CLZ26",
    name: "WTI crude Dec 2026",
    assetClass: "future",
    venueId: "NYMEX-MODEL",
    currency: "USD",
    priceDecimals: 2,
    sizeDecimals: 0,
    lotMicros: 1_000_000,
    tickMicros: 10_000,
    multiplier: 1000,
    paperEligible: false,
    liveEligible: false,
    leveraged: true,
    shortable: false,
    factor: "energy",
    session: "NYMEX energy model",
    dataLabel: "MODEL_ONLY",
    notes: "Crude future. Not DBC and not a CFD.",
    contract: { expiry: "2026-11-20", delivery: "physical delivery not enabled", productKind: "energy-future" },
  },
  {
    id: "EVT-DEMO",
    symbol: "EVT-DEMO",
    name: "Illustrative event contract",
    assetClass: "prediction",
    venueId: "SIM-EVENT",
    currency: "USD",
    priceDecimals: 2,
    sizeDecimals: 0,
    lotMicros: 1_000_000,
    tickMicros: 10_000,
    multiplier: 1,
    paperEligible: false,
    liveEligible: false,
    leveraged: false,
    shortable: false,
    factor: "event",
    session: "model",
    dataLabel: "MODEL_ONLY",
    notes: "No venue is connected. Ambiguous resolution blocks the contract even if a model probability looks favorable.",
    contract: { payoff: "1.00 if resolved yes, else 0", resolutionAmbiguous: true, productKind: "event-contract" },
  },
];

function inst(
  id: string,
  name: string,
  assetClass: AssetClass,
  venueId: string,
  paperEligible: boolean,
  leveraged: boolean,
  factor: string,
  session: string,
  notes: string,
): Instrument {
  return {
    id,
    symbol: id,
    name,
    assetClass,
    venueId,
    currency: "USD",
    priceDecimals: 2,
    sizeDecimals: 0,
    lotMicros: 1_000_000,
    tickMicros: 10_000,
    multiplier: 1,
    paperEligible,
    liveEligible: false,
    leveraged,
    shortable: false,
    factor,
    session,
    dataLabel: paperEligible ? "SIMULATED_FIXTURE" : "MODEL_ONLY",
    notes,
  };
}

export const QUOTES: Record<string, Quote> = {
  SPY: quote("SPY", 500_000_000, 5_000),
  QQQ: quote("QQQ", 430_000_000, 10_000),
  IWM: quote("IWM", 220_000_000, 10_000),
  GLD: quote("GLD", 240_000_000, 10_000),
  TLT: quote("TLT", 92_000_000, 10_000),
  EFA: quote("EFA", 78_000_000, 10_000),
  EEM: quote("EEM", 44_000_000, 10_000),
  DBC: quote("DBC", 23_000_000, 10_000),
  VNQ: quote("VNQ", 90_000_000, 10_000),
  BIL: quote("BIL", 91_500_000, 5_000),
  "BTC-USD": quote("BTC-USD", 64_000_000_000, 16_000_000),
  "ETH-USD": quote("ETH-USD", 3_200_000_000, 1_000_000),
  EURUSD: quote("EURUSD", 1_085_000, 20),
  USDJPY: quote("USDJPY", 152_000_000, 10_000),
  SPY261218C500: quote("SPY261218C500", 12_500_000, 150_000),
  MESZ26: quote("MESZ26", 5_000_000_000, 250_000),
  GCZ26: quote("GCZ26", 2_650_000_000, 200_000),
  CLZ26: quote("CLZ26", 78_000_000, 10_000),
  "EVT-DEMO": quote("EVT-DEMO", 420_000, 10_000),
};

export function instrument(id: string): Instrument | undefined {
  return INSTRUMENTS.find((i) => i.id === id);
}

export function quoteOf(id: string): Quote | undefined {
  return QUOTES[id];
}

export const STRATEGIES: StrategyDefinition[] = [
  {
    id: "s1-intraday",
    version: "sprint-1",
    name: "Sprint 1 intraday set",
    family: "Intraday (four strategies)",
    markets: "US equities",
    state: "RETIRED",
    hypothesis: "Short-horizon intraday signals would survive costs on free US equity data.",
    entry: "Not reconstructed. The bundle did not contain the strategy source.",
    exit: "Not reconstructed.",
    horizon: "Intraday",
    costModel: "Prior record says realistic costs were applied.",
    failureModes: "Free data was not live-feasible. Development and replication were both negative.",
    retirement: "Stopped before validation. Orders later tagged forward_test are not evidence. Figures are not invented here.",
    evidence: "preserved-note",
    ceiling: "RETIRED",
  },
  {
    id: "s2-holdout",
    version: "sprint-2",
    name: "Sprint 2 holdout",
    family: "Intraday follow-up",
    markets: "US equities",
    state: "RETIRED",
    hypothesis: "A second intraday pass would hold up out of sample.",
    entry: "Not reconstructed.",
    exit: "Not reconstructed.",
    horizon: "Intraday",
    costModel: "Costs cited as the reason S1 failed.",
    failureModes: "S2 faded after publication. S1 lost to costs and could not select names on free live data.",
    retirement: "Recovered merge note: S1 stopped, S2 holdout results. Numeric artifacts were not in the bundle.",
    evidence: "preserved-note",
    ceiling: "RETIRED",
  },
  {
    id: "orb-cost-control",
    version: "illustrative-v1",
    name: "Opening-range breakout cost control",
    family: "Opening-range breakout",
    markets: "Synthetic single name",
    state: "RETIRED",
    hypothesis: "A 4 cent continuation after a breakout is not a trade when the spread and slippage are 8 bps a side.",
    entry: "Break of the first six bars, filled at the next bar's open.",
    exit: "Flattened at the next open after bar 9. No same-bar close fill.",
    horizon: "One session, repeated identically for 40 sessions.",
    costModel: "0, 8, and 16 bps per side. The path is constructed, not a market.",
    failureModes: "Gross edge is smaller than pre-registered costs. Zero variance makes Sharpe meaningless.",
    retirement: "Net expectancy is negative after 8 bps. The construction is disclosed. It is not optimized and cannot be revived.",
    evidence: "computed-control",
    ceiling: "RETIRED",
  },
  {
    id: "t1-tsmom",
    version: "draft-2026-11-11",
    name: "T1 ETF time-series momentum",
    family: "Trend following",
    markets: "SPY EFA EEM TLT IEF GLD DBC VNQ",
    state: "IDEA",
    hypothesis: "Sign of 12-month excess return over T-bills, long or flat, vol-targeted, has a positive net edge on a fixed ETF basket.",
    entry: "Month-end signal. Rebalance at the next opening auction. No shorts.",
    exit: "Flat when the 12-month excess return is negative.",
    horizon: "Months",
    costModel: "A few basis points a year. Not scored.",
    failureModes: "Draft windows do not match listings. BIL starts 2007-05-30. Yahoo adjusted close is not point-in-time. No second vendor. Not scored.",
    retirement: "Protocol is a draft. Open data questions must be answered before any result is looked at.",
    evidence: "none",
    ceiling: "IDEA",
  },
  {
    id: "t2-overnight",
    version: "draft-2026-11-11",
    name: "T2 overnight drift",
    family: "Overnight drift",
    markets: "SPY QQQ",
    state: "IDEA",
    hypothesis: "Close-to-open drift on SPY and QQQ exceeds about 1 bp of auction cost.",
    entry: "Buy the closing auction.",
    exit: "Sell the next opening auction. 1x, no leverage.",
    horizon: "Overnight",
    costModel: "Auction cost not yet measured. Not scored.",
    failureModes: "QQQ starts 1999-03-10, not 1993-02. Auction cost is unmeasured. Ex-date cash must be added or the overnight holder is understated. Not scored.",
    retirement: "Draft only. Not a day trade, but still unscored.",
    evidence: "none",
    ceiling: "IDEA",
  },
  {
    id: "paper-mechanics",
    version: "plumbing-1",
    name: "Paper plumbing",
    family: "Operations",
    markets: "Paper-eligible ETFs",
    state: "PAPER",
    hypothesis: "None. This strategy checks the order path. Fills are not performance evidence.",
    entry: "Operator ticket only, after the risk engine approves.",
    exit: "Operator close, or a risk block on new exposure.",
    horizon: "Intraday paper session",
    costModel: "Fixture spread plus 2 bps slippage.",
    failureModes: "Treating plumbing fills as an edge.",
    retirement: "Cannot advance past PAPER. Live is locked.",
    evidence: "none",
    ceiling: "PAPER",
  },
  ...[
    ["trend", "Trend following", "Equities, FX, crypto, futures", "Regime persistence. Not tested."],
    ["xsec-mom", "Cross-sectional momentum", "Equities, ETFs, crypto", "Relative strength. Not tested."],
    ["mean-rev", "Mean reversion", "Equities, ETFs, FX", "Costs often erase the edge. Not tested."],
    ["pairs", "Pairs trading", "Equities, ETFs, crypto", "Cointegration and borrow. Not tested."],
    ["vrp", "Variance risk premium", "Options", "Tail risk. Naked short premium is forbidden. Not tested."],
    ["spreads", "Defined-risk option spreads", "Options", "Assignment can exceed the textbook max loss. Not tested."],
    ["carry", "Time-series carry", "FX, futures", "Roll yield and financing. Not tested."],
    ["factors", "Factor rotation", "Equities, ETFs", "Momentum, value, quality. Not tested."],
    ["event", "Event-driven", "Equities, event contracts", "Needs a real release timestamp. Not tested."],
    ["mm", "Market making research", "Crypto, liquid venues", "Adverse selection. Not pursued at high frequency."],
    ["xvenue", "Cross-venue arbitrage", "Crypto", "Often negative after fees and withdrawal costs. Not tested."],
  ].map(([id, name, markets, hypothesis]) => ({
    id: id as string,
    version: "idea-0",
    name: name as string,
    family: name as string,
    markets: markets as string,
    state: "IDEA" as const,
    hypothesis: hypothesis as string,
    entry: "Unspecified until a protocol is frozen.",
    exit: "Unspecified.",
    horizon: "Unspecified",
    costModel: "Must include spread, commission, and slippage before any promotion.",
    failureModes: "No sample yet.",
    retirement: "Retire if the net edge disappears under doubled costs.",
    evidence: "none" as const,
    ceiling: "IDEA" as const,
  })),
];

export function strategy(id: string): StrategyDefinition | undefined {
  return STRATEGIES.find((s) => s.id === id);
}

export function initialBook(): Book {
  return {
    mode: "RESEARCH",
    liveLocked: true,
    nowTs: AS_OF,
    dayStartEquityCents: STARTING_CASH_CENTS,
    peakEquityCents: STARTING_CASH_CENTS,
    cashCents: STARTING_CASH_CENTS,
    positions: [],
    orders: [],
    audits: [
      {
        id: "audit-0",
        ts: AS_OF,
        actor: "system",
        action: "session-open",
        detail: "Research mode. Live locked. Cash is simulated. Fixtures are not a market feed.",
      },
    ],
    kill: {
      blockNew: false,
      cancelRequested: false,
      flattenRequested: false,
      brokerConnected: false,
      positionsConfirmedFlat: false,
    },
    dataStatus: "fresh",
    reconciliation: "matched",
    credentials: "absent",
    restricted: [],
    withdrawalHalt: [],
    reviewRequired: false,
    lastMessage: "Research mode. No order can be submitted until you enable the paper session.",
  };
}

export function advance(book: Book, seconds = 1): string {
  const t = Date.parse(book.nowTs) + seconds * 1000;
  return new Date(t).toISOString().replace(".000Z", ".000Z");
}

export function markPrice(instrumentId: string): number {
  const qte = quoteOf(instrumentId);
  if (!qte) return 0;
  return qte.lastMicros;
}

export function positionNotionalCents(book: Book, instrumentId: string, qtyMicros = positionQty(book, instrumentId)): number {
  return notionalCents(markPrice(instrumentId), qtyMicros);
}

export function positionQty(book: Book, instrumentId: string): number {
  return book.positions.find((p) => p.instrumentId === instrumentId)?.qtyMicros ?? 0;
}

export function equityCents(book: Book): number {
  let value = book.cashCents;
  for (const p of book.positions) {
    value += notionalCents(markPrice(p.instrumentId), p.qtyMicros);
  }
  return value;
}

export function unrealizedCents(book: Book): number {
  let u = 0;
  for (const p of book.positions) {
    u += notionalCents(markPrice(p.instrumentId) - p.avgPriceMicros, p.qtyMicros);
  }
  return u;
}

export function realizedCents(book: Book): number {
  return book.positions.reduce((s, p) => s + p.realizedCents, 0);
}

export function dailyPnlCents(book: Book): number {
  return equityCents(book) - book.dayStartEquityCents;
}

export function drawdown(book: Book): number {
  const eq = equityCents(book);
  if (book.peakEquityCents <= 0) return 0;
  return Math.max(0, (book.peakEquityCents - eq) / book.peakEquityCents);
}

export interface ExposureRow {
  key: string;
  grossCents: number;
  netCents: number;
}

export function exposures(book: Book): { grossCents: number; netCents: number; byFactor: ExposureRow[]; byClass: ExposureRow[]; byStrategy: ExposureRow[] } {
  const factor = new Map<string, ExposureRow>();
  const klass = new Map<string, ExposureRow>();
  const strat = new Map<string, ExposureRow>();
  let gross = 0;
  let net = 0;
  for (const p of book.positions) {
    const inst = instrument(p.instrumentId);
    const signed = notionalCents(markPrice(p.instrumentId), p.qtyMicros);
    const abs = Math.abs(signed);
    gross += abs;
    net += signed;
    add(factor, inst?.factor ?? "unknown", signed, abs);
    add(klass, inst?.assetClass ?? "unknown", signed, abs);
    add(strat, p.strategyId, signed, abs);
  }
  return {
    grossCents: gross,
    netCents: net,
    byFactor: [...factor.values()],
    byClass: [...klass.values()],
    byStrategy: [...strat.values()],
  };
}

function add(map: Map<string, ExposureRow>, key: string, signed: number, abs: number) {
  const row = map.get(key) ?? { key, grossCents: 0, netCents: 0 };
  row.grossCents += abs;
  row.netCents += signed;
  map.set(key, row);
}

export function factorGross(book: Book, factorName: string, extraCents = 0): number {
  const row = exposures(book).byFactor.find((r) => r.key === factorName);
  return (row?.grossCents ?? 0) + Math.abs(extraCents);
}
