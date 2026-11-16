/**
 * Read-only Hermes outcome ingestion.
 * Simulated fills are never reported as real performance.
 */

export type OutcomeSource = "MOCK" | "PAPER" | "LIVE";

export interface ExecutionOutcome {
  decisionId: string;
  strategyVersion: string;
  clientOrderId: string;
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  fillPrice: number;
  intendedPrice: number;
  fee: number;
  source: OutcomeSource;
  brokerConfirmed: boolean;
  corrected: boolean;
}

export interface OutcomeReport {
  matched: number;
  missing: string[];
  duplicates: string[];
  realizedPnl: number | null;
  costs: number | null;
  slippage: number | null;
  realPerformance: boolean;
  notes: string[];
}

export function ingestOutcomes(rows: ExecutionOutcome[]): OutcomeReport {
  const seen = new Set<string>();
  const duplicates: string[] = [];
  const missing: string[] = [];
  const notes: string[] = [];
  let pnl = 0;
  let costs = 0;
  let slippage = 0;
  let real = true;
  let usable = 0;
  for (const row of rows) {
    const key = `${row.decisionId}|${row.strategyVersion}|${row.clientOrderId}`;
    if (!row.decisionId || !row.strategyVersion || !row.clientOrderId) {
      missing.push(key);
      continue;
    }
    if (seen.has(key) && !row.corrected) {
      duplicates.push(key);
      continue;
    }
    seen.add(key);
    if (row.source === "MOCK" || !row.brokerConfirmed) {
      real = false;
      notes.push(`${row.clientOrderId} is ${row.source} and is not real performance`);
      continue;
    }
    const signed = row.side === "sell" ? 1 : -1;
    pnl += signed * row.qty * row.fillPrice - row.fee;
    costs += row.fee;
    slippage += Math.abs(row.fillPrice - row.intendedPrice) * row.qty;
    usable += 1;
  }
  return {
    matched: usable,
    missing,
    duplicates,
    realizedPnl: usable ? pnl : null,
    costs: usable ? costs : null,
    slippage: usable ? slippage : null,
    realPerformance: usable > 0 && real,
    notes,
  };
}
