export interface RawBar {
  date: string;
  exchangeTs: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** Vendor side field. Not a point-in-time price. */
  yahooAdjClose: number | null;
}

export interface RawDividend {
  exDate: string | null;
  exTs: string | null;
  amount: number | null;
}

export interface RawSplit {
  exDate: string | null;
  exTs: string | null;
  numerator: number | null;
  denominator: number | null;
}

export interface SnapshotFile {
  symbol: string;
  path: string;
  sha256: string;
  bytes: number;
  bars: number;
  first: string | null;
  last: string | null;
  dividends: number;
  splits: number;
  nullBarsDropped: number;
}

export interface ProviderAttempt {
  name: string;
  url: string;
  http?: number;
  bytes?: number;
  kind?: string;
  starts?: string;
  historicalRows?: number | null;
  error?: string;
}

export interface DataManifest {
  provider: string;
  fetchedUtc: string;
  adjustedCloseIsPointInTime: false;
  sessionDateRule: string;
  utcVersusNewYorkDateMismatches: number;
  files: SnapshotFile[];
  secondSource: {
    status: "BLOCKED" | "COMPARED";
    reason: string;
    attempts: ProviderAttempt[];
  };
}
