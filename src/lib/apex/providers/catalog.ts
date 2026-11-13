export type ProviderStatus = "OK" | "STALE" | "UNAVAILABLE" | "DENIED";

export interface ProviderRecord {
  id: string;
  status: ProviderStatus;
  reason: string;
  license: string;
}

export const PROVIDERS: ProviderRecord[] = [
  { id: "yahoo", status: "OK", reason: "Local daily files for SPY and peers.", license: "Yahoo terms. Research only." },
  { id: "coinbase", status: "OK", reason: "Local daily BTC and ETH candles.", license: "Coinbase public candles." },
  { id: "alpaca-paper", status: "OK", reason: "Paper account exists. Not used as a live quote here.", license: "Alpaca paper terms." },
  { id: "kraken", status: "OK", reason: "Freqtrade dry-run uses public Kraken candles.", license: "Kraken public data." },
  { id: "sec-edgar", status: "UNAVAILABLE", reason: "No EDGAR client is configured.", license: "SEC public. Not connected." },
  { id: "fred", status: "UNAVAILABLE", reason: "No FRED key.", license: "FRED terms. Not connected." },
  { id: "news", status: "UNAVAILABLE", reason: "No authorized news API.", license: "Not connected." },
  { id: "polymarket", status: "UNAVAILABLE", reason: "No Gamma or CLOB client.", license: "Not connected." },
  { id: "reddit", status: "DENIED", reason: "OAuth not approved. Not scraped.", license: "Reddit API terms." },
  { id: "x", status: "DENIED", reason: "Adapter disabled until access and cost are approved.", license: "X API terms." },
];

export function failClosed(id: string): ProviderRecord {
  return PROVIDERS.find((row) => row.id === id) ?? { id, status: "UNAVAILABLE", reason: "Unknown provider.", license: "none" };
}
