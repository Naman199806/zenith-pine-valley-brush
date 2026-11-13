export interface EvidenceBundle {
  id: string;
  instrument: string;
  timeframe: "1d";
  source: string;
  lastCompleted: string;
  closes: number[];
  note: string;
}

export function btcEvidence(): EvidenceBundle {
  return {
    id: "btc-daily-20261112",
    instrument: "BTC-USD",
    timeframe: "1d",
    source: "Coinbase public candles",
    lastCompleted: "2026-11-12",
    closes: [71300, 71425, 71251, 71384, 71150],
    note: "Last five completed daily closes. The 2026-11-13 bar is incomplete and excluded.",
  };
}
