export interface BrokerPositionView {
  symbol: string;
  qty: number;
  avgEntry: string;
  unrealizedPl: string;
  marketValue: string;
}

export interface LedgerLine {
  symbol: string;
  qty: number;
}

/** Strategy intent and broker fills are compared. They are not the same ledger. */
export function reconcileLedgers(strategy: LedgerLine[], broker: LedgerLine[]): { clean: boolean; notes: string[] } {
  const notes: string[] = [];
  const symbols = new Set([...strategy.map((line) => line.symbol), ...broker.map((line) => line.symbol)]);
  for (const symbol of symbols) {
    const intended = strategy.find((line) => line.symbol === symbol)?.qty ?? 0;
    const actual = broker.find((line) => line.symbol === symbol)?.qty ?? 0;
    if (actual < 0) notes.push(`${symbol} is short at the broker.`);
    if (intended !== actual) notes.push(`${symbol}: strategy ledger ${intended}, broker fill ${actual}.`);
  }
  return { clean: notes.length === 0, notes };
}
