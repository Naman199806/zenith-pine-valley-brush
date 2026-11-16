/**
 * Crash-safe persistent Hermes journal.
 * Atomic intent creation via temp-file + rename.
 * Single-use authorization consumption survives process restart.
 * Recovery loads the last durable snapshot.
 */

import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import type { IntentRecord } from "./executor.ts";

export interface JournalEntry extends IntentRecord {
  consumed: boolean;
  recoveryNotes: string[];
}

interface Snapshot {
  entries: JournalEntry[];
  consumedAuth: string[];
}

export class HermesJournal {
  private entries = new Map<string, JournalEntry>();
  private consumedAuth = new Set<string>();
  private path: string;

  constructor(path: string) {
    this.path = path;
    mkdirSync(dirname(path), { recursive: true });
    if (existsSync(path)) this.load();
  }

  private load(): void {
    try {
      const raw = readFileSync(this.path, "utf8");
      const snap = JSON.parse(raw) as Snapshot;
      this.entries = new Map(snap.entries.map((e) => [e.clientOrderId, e]));
      this.consumedAuth = new Set(snap.consumedAuth);
    } catch {
      throw new Error("journal snapshot corrupt; fail closed");
    }
  }

  private save(): void {
    const snap: Snapshot = {
      entries: Array.from(this.entries.values()),
      consumedAuth: Array.from(this.consumedAuth),
    };
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(snap, null, 2), "utf8");
    renameSync(tmp, this.path);
  }

  persist(intent: IntentRecord): JournalEntry {
    if (this.consumedAuth.has(intent.ticket.singleUseId)) {
      throw new Error("authorization already consumed");
    }
    const existing = this.entries.get(intent.clientOrderId);
    if (existing) {
      const same = existing.ticket.side === intent.ticket.side && existing.ticket.symbol === intent.ticket.symbol && existing.equityIdentity?.qty === intent.equityIdentity?.qty;
      if (!same) throw new Error("conflicting client order id reuse");
      return existing;
    }
    const entry: JournalEntry = { ...intent, consumed: false, recoveryNotes: [] };
    this.entries.set(intent.clientOrderId, entry);
    this.save();
    return entry;
  }

  transitionPaperState(clientOrderId: string, next: NonNullable<IntentRecord["paperState"]>): JournalEntry {
    const allowed: Record<string, string[]> = {
      PROPOSED: ["AUTHORIZED", "CLOSED"],
      AUTHORIZED: ["SUBMISSION_ATTEMPTED", "CLOSED"],
      SUBMISSION_ATTEMPTED: ["BROKER_CONFIRMED", "UNKNOWN", "CLOSED"],
      UNKNOWN: ["BROKER_CONFIRMED", "CLOSED"],
      BROKER_CONFIRMED: ["CLOSED"],
      CLOSED: [],
    };
    const e = this.entries.get(clientOrderId);
    if (!e) throw new Error("intent not found");
    const current = e.paperState ?? "PROPOSED";
    if (!allowed[current]?.includes(next)) throw new Error(`invalid paper state transition ${current} -> ${next}`);
    e.paperState = next;
    this.save();
    return e;
  }

  consumeAuthorization(singleUseId: string): void {
    if (this.consumedAuth.has(singleUseId)) throw new Error("authorization already consumed");
    this.consumedAuth.add(singleUseId);
    for (const e of Array.from(this.entries.values())) {
      if (e.ticket.singleUseId === singleUseId) e.consumed = true;
    }
    this.save();
  }

  updateStatus(clientOrderId: string, status: IntentRecord["status"], filledQty: number, avgPrice: number | null, note?: string): JournalEntry {
    const e = this.entries.get(clientOrderId);
    if (!e) throw new Error("intent not found");
    e.status = status;
    e.filledQty = filledQty;
    e.avgPrice = avgPrice;
    if (note) e.recoveryNotes.push(note);
    this.save();
    return e;
  }

  /**
   * Unknown submission recovery: look up by original client-order ID.
   * Never resubmit. Map broker status into the journal.
   */
  reconcileByClientOrderId(clientOrderId: string, brokerStatus: string, filledQty: number): JournalEntry {
    const mapped =
      brokerStatus === "filled" ? "FILLED" :
      brokerStatus === "partially_filled" ? "PARTIAL" :
      brokerStatus === "rejected" ? "REJECTED" :
      brokerStatus === "canceled" ? "CANCELED" :
      "UNKNOWN";
    return this.updateStatus(clientOrderId, mapped, filledQty, null, `reconciled by client_order_id status=${brokerStatus}; no resubmit`);
  }

  replay(): JournalEntry[] {
    return Array.from(this.entries.values());
  }

  get(clientOrderId: string): JournalEntry | undefined {
    return this.entries.get(clientOrderId);
  }

  isConsumed(singleUseId: string): boolean {
    return this.consumedAuth.has(singleUseId);
  }
}

export interface MockOrder {
  clientOrderId: string;
  status: "accepted" | "filled" | "partially_filled" | "rejected" | "canceled";
  filledQty: number;
  requestedQty: number;
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
    if (this.orders.has(clientOrderId)) return this.orders.get(clientOrderId)!;
    if (this.failNext) {
      this.failNext = false;
      const rejected: MockOrder = { clientOrderId, status: "rejected", filledQty: 0, requestedQty: qty, side, symbol };
      this.orders.set(clientOrderId, rejected);
      return rejected;
    }
    if (side === "sell" && qty > this.position + 1e-12) {
      const rejected: MockOrder = { clientOrderId, status: "rejected", filledQty: 0, requestedQty: qty, side, symbol };
      this.orders.set(clientOrderId, rejected);
      return rejected;
    }
    const filled = side === "buy" ? qty : qty;
    const order: MockOrder = { clientOrderId, status: "filled", filledQty: filled, requestedQty: qty, side, symbol };
    this.orders.set(clientOrderId, order);
    if (side === "buy") this.position += filled;
    else this.position -= filled;
    return order;
  }

  partialFill(clientOrderId: string, qty: number): MockOrder {
    const o = this.orders.get(clientOrderId);
    if (!o) throw new Error("order not found");
    if (qty < 0 || qty > o.requestedQty) throw new Error("partial quantity invalid");
    const delta = qty - o.filledQty;
    o.status = qty >= o.requestedQty ? "filled" : "partially_filled";
    o.filledQty = qty;
    if (o.side === "buy") this.position += delta;
    else this.position -= delta;
    return o;
  }

  complete(clientOrderId: string): MockOrder {
    const o = this.orders.get(clientOrderId);
    if (!o) throw new Error("order not found");
    return this.partialFill(clientOrderId, o.requestedQty);
  }

  lookupByClientOrderId(clientOrderId: string): MockOrder | undefined {
    return this.orders.get(clientOrderId);
  }

  getPosition(): number {
    return this.position;
  }

  openOrders(): number {
    return Array.from(this.orders.values()).filter((o) => o.status === "accepted" || o.status === "partially_filled").length;
  }
}
