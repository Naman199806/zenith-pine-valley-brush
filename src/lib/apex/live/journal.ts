/**
 * Durable Hermes intent journal (in-memory for tests; file-backed optional).
 * Single-use authorization consumption. Idempotent client order IDs.
 * Unknown-status reconciliation. Partial-fill and rejected-order recovery.
 * Crash recovery via replay of persisted intents.
 */

import type { IntentRecord, TicketAuthorization } from "./executor.ts";

export interface JournalEntry extends IntentRecord {
  consumed: boolean;
  recoveryNotes: string[];
}

export class HermesJournal {
  private entries = new Map<string, JournalEntry>();
  private consumedAuth = new Set<string>();

  persist(intent: IntentRecord): JournalEntry {
    if (this.consumedAuth.has(intent.ticket.singleUseId)) {
      throw new Error("authorization already consumed");
    }
    const existing = Array.from(this.entries.values()).find((e) => e.clientOrderId === intent.clientOrderId);
    if (existing) return existing; // idempotent
    const entry: JournalEntry = { ...intent, consumed: false, recoveryNotes: [] };
    this.entries.set(intent.clientOrderId, entry);
    return entry;
  }

  consumeAuthorization(singleUseId: string): void {
    if (this.consumedAuth.has(singleUseId)) throw new Error("authorization already consumed");
    this.consumedAuth.add(singleUseId);
    for (const e of Array.from(this.entries.values())) {
      if (e.ticket.singleUseId === singleUseId) e.consumed = true;
    }
  }

  updateStatus(clientOrderId: string, status: IntentRecord["status"], filledQty: number, avgPrice: number | null, note?: string): JournalEntry {
    const e = this.entries.get(clientOrderId);
    if (!e) throw new Error("intent not found");
    e.status = status;
    e.filledQty = filledQty;
    e.avgPrice = avgPrice;
    if (note) e.recoveryNotes.push(note);
    return e;
  }

  reconcileUnknown(clientOrderId: string, brokerStatus: string, filledQty: number): JournalEntry {
    const mapped = brokerStatus === "filled" ? "FILLED" : brokerStatus === "partially_filled" ? "PARTIAL" : brokerStatus === "rejected" ? "REJECTED" : brokerStatus === "canceled" ? "CANCELED" : "UNKNOWN";
    return this.updateStatus(clientOrderId, mapped, filledQty, null, `reconciled from broker status ${brokerStatus}`);
  }

  replay(): JournalEntry[] {
    return Array.from(this.entries.values());
  }

  get(clientOrderId: string): JournalEntry | undefined {
    return this.entries.get(clientOrderId);
  }
}

export interface MockOrder {
  clientOrderId: string;
  status: "accepted" | "filled" | "partially_filled" | "rejected" | "canceled";
  filledQty: number;
  side: "buy" | "sell";
  symbol: string;
}

export class MockBroker {
  private orders = new Map<string, MockOrder>();
  private position = 0;
  failNext = false;
  disconnectNext = false;

  submit(clientOrderId: string, side: "buy" | "sell", qty: number, symbol: string): MockOrder {
    if (this.disconnectNext) {
      this.disconnectNext = false;
      throw new Error("network disconnect");
    }
    if (this.failNext) {
      this.failNext = false;
      const rejected: MockOrder = { clientOrderId, status: "rejected", filledQty: 0, side, symbol };
      this.orders.set(clientOrderId, rejected);
      return rejected;
    }
    if (this.orders.has(clientOrderId)) return this.orders.get(clientOrderId)!; // idempotent
    const filled = side === "buy" ? qty : Math.min(qty, this.position);
    const status = filled > 0 ? "filled" : "rejected";
    const order: MockOrder = { clientOrderId, status, filledQty: filled, side, symbol };
    this.orders.set(clientOrderId, order);
    if (side === "buy") this.position += filled;
    else this.position -= filled;
    return order;
  }

  partialFill(clientOrderId: string, qty: number): MockOrder {
    const o = this.orders.get(clientOrderId);
    if (!o) throw new Error("order not found");
    o.status = "partially_filled";
    o.filledQty = qty;
    if (o.side === "buy") this.position = qty;
    return o;
  }

  complete(clientOrderId: string): MockOrder {
    const o = this.orders.get(clientOrderId);
    if (!o) throw new Error("order not found");
    o.status = "filled";
    return o;
  }

  getPosition(): number {
    return this.position;
  }

  openOrders(): number {
    return Array.from(this.orders.values()).filter((o) => o.status === "accepted" || o.status === "partially_filled").length;
  }
}
