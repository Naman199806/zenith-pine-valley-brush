export interface Bar {
  ts: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  complete: boolean;
}

export interface ResearchInput {
  symbol: string;
  asOf: string;
  source: string;
  bars: Bar[];
  filings: string[];
  news: string[];
  macro: string[];
  options: string[];
  missing: string[];
}

export function btcPacket(): ResearchInput {
  return {
    symbol: "BTC/USD",
    asOf: "2026-11-12T00:00:00Z",
    source: "coinbase-public",
    bars: [
      { ts: "2026-11-11T00:00:00Z", open: 73927.63, high: 74123.71, low: 71008, close: 71369.9, volume: 10490.82533238, complete: true },
      { ts: "2026-11-13T00:00:00Z", open: 71369.9, high: 71429.46, low: 71333.66, close: 71361.54, volume: 27.08487923, complete: false },
    ],
    filings: [],
    news: [],
    macro: [],
    options: [],
    missing: ["filings", "news", "macro", "options"],
  };
}

export function completedBars(input: ResearchInput): Bar[] {
  return input.bars.filter((bar) => bar.complete);
}
