/**
 * Mock-only PAPER acceptance contracts.
 * Pilot/Hermes research side. Not an Executor submission path.
 */

export type MockState = "PROPOSED" | "AUTHORIZED" | "PARTIAL" | "OPEN" | "EXIT_PENDING" | "CLOSED" | "REJECTED" | "UNKNOWN";

export interface MockProposal {
  decisionId: string;
  clientOrderId: string;
  symbol: "SPY" | "QQQ" | "IWM";
  side: "buy" | "sell";
  qty: number;
  limitPrice: number;
  signed: boolean;
  sigmaApproved: boolean;
  sentinelApproved: boolean;
  strategyApproved: false;
}

export interface MockFill {
  clientOrderId: string;
  qty: number;
  price: number;
  source: "MOCK";
}

export interface MockBook {
  state: MockState;
  filledQty: number;
  seen: string[];
  realPerformance: false;
}

export function acceptProposal(p: MockProposal, seen: Set<string>): { ok: boolean; reason: string } {
  if (!p.signed) return { ok: false, reason: "unsigned proposal" };
  if (!p.sigmaApproved || !p.sentinelApproved) return { ok: false, reason: "risk veto" };
  if (p.strategyApproved !== false) return { ok: false, reason: "strategy cannot be asserted" };
  if (seen.has(p.clientOrderId)) return { ok: false, reason: "duplicate" };
  if (!(p.qty > 0) || p.qty * p.limitPrice > 25) return { ok: false, reason: "cap exceeded" };
  seen.add(p.clientOrderId);
  return { ok: true, reason: "mock accepted; no broker POST" };
}

export function applyMockFill(book: MockBook, fill: MockFill): MockBook {
  if (fill.source !== "MOCK") throw new Error("only mock fills allowed here");
  const filled = book.filledQty + fill.qty;
  return { ...book, filledQty: filled, state: filled > 0 ? "PARTIAL" : book.state, realPerformance: false };
}

export function authorizeMockExit(book: MockBook, sellQty: number, ownedQty: number): MockBook {
  if (sellQty > ownedQty) throw new Error("oversell");
  return { ...book, state: "EXIT_PENDING" };
}
