/**
 * Read-only Hermes feedback.
 * Realized P&L requires matched BUY/SELL quantity and traceable Executor evidence.
 * MOCK is never broker-confirmed performance.
 */

export type OutcomeSource = "MOCK" | "PAPER" | "LIVE";
export type LotStatus = "UNREALIZED" | "INCOMPLETE" | "CLOSED";

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
  brokerOrderId: string | null;
  fillId: string | null;
  corrected: boolean;
}

export interface PositionView {
  symbol: string;
  source: OutcomeSource;
  status: LotStatus;
  openQty: number;
  realizedPnl: number;
  costs: number;
  slippage: number;
}

export interface OutcomeReport {
  paper: PositionView[];
  live: PositionView[];
  mockIgnored: number;
  duplicates: string[];
  missing: string[];
  notes: string[];
}

interface Lot { qty: number; price: number; feePerUnit: number; intended: number; }

function confirmed(row: ExecutionOutcome): boolean {
  return row.source !== "MOCK" && !!row.brokerOrderId && !!row.fillId && row.qty > 0 && Number.isFinite(row.fillPrice);
}

export function ingestOutcomes(rows: ExecutionOutcome[]): OutcomeReport {
  const seen = new Set<string>();
  const duplicates: string[] = [];
  const missing: string[] = [];
  const notes: string[] = [];
  const books = new Map<string, { lots: Lot[]; realized: number; costs: number; slippage: number; source: OutcomeSource; symbol: string }>();
  let mockIgnored = 0;

  for (const row of rows) {
    const key = `${row.decisionId}|${row.strategyVersion}|${row.clientOrderId}|${row.fillId ?? ""}`;
    if (!row.decisionId || !row.strategyVersion || !row.clientOrderId) {
      missing.push(key);
      continue;
    }
    if (row.source === "MOCK") {
      mockIgnored += 1;
      notes.push(`${row.clientOrderId} MOCK ignored`);
      continue;
    }
    if (seen.has(key) && !row.corrected) {
      duplicates.push(key);
      continue;
    }
    seen.add(key);
    if (!confirmed(row)) {
      missing.push(key);
      notes.push(`${row.clientOrderId} incomplete evidence`);
      continue;
    }
    const bookKey = `${row.source}|${row.symbol}|${row.strategyVersion}`;
    const book = books.get(bookKey) ?? { lots: [], realized: 0, costs: 0, slippage: 0, source: row.source, symbol: row.symbol };
    if (row.side === "buy") {
      book.lots.push({ qty: row.qty, price: row.fillPrice, feePerUnit: row.fee / row.qty, intended: row.intendedPrice });
      book.costs += row.fee;
      book.slippage += Math.abs(row.fillPrice - row.intendedPrice) * row.qty;
    } else {
      let left = row.qty;
      while (left > 0 && book.lots.length) {
        const lot = book.lots[0]!;
        const take = Math.min(left, lot.qty);
        book.realized += (row.fillPrice - lot.price) * take - lot.feePerUnit * take - (row.fee * take) / row.qty;
        book.costs += (row.fee * take) / row.qty;
        book.slippage += Math.abs(row.fillPrice - row.intendedPrice) * take;
        lot.qty -= take;
        left -= take;
        if (lot.qty === 0) book.lots.shift();
      }
      if (left > 0) notes.push(`${row.clientOrderId} sell exceeds FIFO inventory`);
    }
    books.set(bookKey, book);
  }

  const views = [...books.values()].map((book): PositionView => {
    const openQty = book.lots.reduce((sum, lot) => sum + lot.qty, 0);
    const flat = openQty < 1e-9;
    return {
      symbol: book.symbol,
      source: book.source,
      status: flat && book.realized !== 0 ? "CLOSED" : !flat ? "UNREALIZED" : "INCOMPLETE",
      openQty,
      realizedPnl: openQty === 0 ? book.realized : book.realized,
      costs: book.costs,
      slippage: book.slippage,
    };
  });
  return {
    paper: views.filter((v) => v.source === "PAPER"),
    live: views.filter((v) => v.source === "LIVE"),
    mockIgnored,
    duplicates,
    missing,
    notes,
  };
}

export function adaptExecutorJournal(lines: string[]): { usable: ExecutionOutcome[]; incomplete: number } {
  const usable: ExecutionOutcome[] = [];
  let incomplete = 0;
  for (const line of lines) {
    const row = JSON.parse(line) as { event?: string; clientOrderId?: string };
    if (!row.event || !row.clientOrderId) {
      incomplete += 1;
      continue;
    }
    incomplete += 1;
  }
  return { usable, incomplete };
}
