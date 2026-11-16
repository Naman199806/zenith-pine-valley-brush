/**
 * Read-only Hermes feedback.
 * Realized P&L requires matched, trusted, broker-confirmed closes.
 * MOCK is never performance. PAPER and LIVE stay separate.
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
  at: string;
}

export interface TrustedEvidence {
  clientOrderId: string;
  brokerOrderId: string;
  fillId: string;
  qty: number;
  fillPrice: number;
  source: "PAPER" | "LIVE";
}

export interface PositionView {
  symbol: string;
  source: OutcomeSource;
  status: LotStatus;
  openQty: number;
  realizedPnl: number;
  costs: number;
  slippage: number;
  failed: boolean;
}

export interface OutcomeReport {
  paper: PositionView[];
  live: PositionView[];
  mockIgnored: number;
  duplicates: string[];
  missing: string[];
  notes: string[];
}

interface Lot { qty: number; price: number; feePerUnit: number; }
interface Book { lots: Lot[]; realized: number; costs: number; slippage: number; source: OutcomeSource; symbol: string; failed: boolean; closedQty: number; }

function finite(n: number): boolean {
  return Number.isFinite(n) && n >= 0;
}

function trustedMatch(row: ExecutionOutcome, trusted: TrustedEvidence[]): boolean {
  return trusted.some((t) => t.clientOrderId === row.clientOrderId && t.brokerOrderId === row.brokerOrderId && t.fillId === row.fillId && t.qty === row.qty && t.fillPrice === row.fillPrice && t.source === row.source);
}

export function ingestOutcomes(rows: ExecutionOutcome[], trusted: TrustedEvidence[]): OutcomeReport {
  const latest = new Map<string, ExecutionOutcome>();
  const duplicates: string[] = [];
  const missing: string[] = [];
  const notes: string[] = [];
  let mockIgnored = 0;
  let lastAt = "";
  for (const row of rows) {
    const key = `${row.decisionId}|${row.strategyVersion}|${row.clientOrderId}|${row.fillId ?? ""}`;
    if (!row.decisionId || !row.strategyVersion || !row.clientOrderId || !row.at) {
      missing.push(key);
      continue;
    }
    if (lastAt && row.at < lastAt && !row.corrected) {
      notes.push(`${row.clientOrderId} out of order`);
      missing.push(key);
      continue;
    }
    if (!row.corrected) lastAt = row.at;
    if (row.source === "MOCK") {
      mockIgnored += 1;
      notes.push(`${row.clientOrderId} MOCK ignored`);
      continue;
    }
    if (!finite(row.qty) || !finite(row.fillPrice) || !finite(row.fee) || row.qty === 0) {
      missing.push(key);
      continue;
    }
    const prior = latest.get(key);
    if (prior && !row.corrected) {
      duplicates.push(key);
      continue;
    }
    if (!trustedMatch(row, trusted)) {
      missing.push(key);
      notes.push(`${row.clientOrderId} not in trusted Executor evidence`);
      continue;
    }
    latest.set(key, prior && row.corrected ? { ...row, at: prior.at } : row);
  }

  const books = new Map<string, Book>();
  for (const row of [...latest.values()].sort((a, b) => a.at.localeCompare(b.at))) {
    const bookKey = `${row.source}|${row.symbol}|${row.strategyVersion}`;
    const book = books.get(bookKey) ?? { lots: [], realized: 0, costs: 0, slippage: 0, source: row.source, symbol: row.symbol, failed: false, closedQty: 0 };
    if (row.side === "buy") {
      book.lots.push({ qty: row.qty, price: row.fillPrice, feePerUnit: row.fee / row.qty });
      book.costs += row.fee;
      book.slippage += Math.abs(row.fillPrice - row.intendedPrice) * row.qty;
    } else {
      let left = row.qty;
      while (left > 1e-12 && book.lots.length) {
        const lot = book.lots[0]!;
        const take = Math.min(left, lot.qty);
        book.realized += (row.fillPrice - lot.price) * take - lot.feePerUnit * take - (row.fee * take) / row.qty;
        book.costs += (row.fee * take) / row.qty;
        book.slippage += Math.abs(row.fillPrice - row.intendedPrice) * take;
        book.closedQty += take;
        lot.qty -= take;
        left -= take;
        if (lot.qty <= 1e-12) book.lots.shift();
      }
      if (left > 1e-12) book.failed = true;
    }
    books.set(bookKey, book);
  }

  const views = [...books.values()].map((book): PositionView => {
    const openQty = book.lots.reduce((sum, lot) => sum + lot.qty, 0);
    const flat = openQty < 1e-9 && !book.failed && book.closedQty > 0;
    return {
      symbol: book.symbol,
      source: book.source,
      status: book.failed ? "INCOMPLETE" : flat ? "CLOSED" : openQty > 1e-9 ? "UNREALIZED" : "INCOMPLETE",
      openQty,
      realizedPnl: book.realized,
      costs: book.costs,
      slippage: book.slippage,
      failed: book.failed,
    };
  });
  return { paper: views.filter((v) => v.source === "PAPER"), live: views.filter((v) => v.source === "LIVE"), mockIgnored, duplicates, missing, notes };
}

export function adaptExecutorJournal(lines: string[]): { usable: ExecutionOutcome[]; incomplete: number } {
  let incomplete = 0;
  for (const line of lines) {
    const row = JSON.parse(line) as { kind?: string; event?: string; clientOrderId?: string; fillId?: string; fillPrice?: number };
    if (!(row.kind || row.event) || !row.clientOrderId || !row.fillId || !Number.isFinite(row.fillPrice)) incomplete += 1;
  }
  return { usable: [], incomplete };
}
