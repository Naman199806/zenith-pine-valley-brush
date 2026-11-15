export interface MockOrder { id: string; clientId: string; side: "buy" | "sell"; qty: number; filled: number; status: "filled" | "partial" | "rejected" | "open"; price: number; }

export class MockBroker {
  orders: MockOrder[] = [];
  position = 0;
  cash = 1000;
  seen = new Set<string>();
  failNextStop = false;
  partial: boolean;
  constructor(partial = false) { this.partial = partial; }
  submit(clientId: string, side: "buy" | "sell", qty: number, price: number): MockOrder {
    if (this.seen.has(clientId)) throw new Error("duplicate client order id");
    this.seen.add(clientId);
    if (side === "sell" && this.failNextStop) {
      this.failNextStop = false;
      const rejected = { id: `rej-${this.orders.length}`, clientId, side, qty, filled: 0, status: "rejected" as const, price };
      this.orders.push(rejected);
      return rejected;
    }
    const filled = this.partial && side === "buy" ? qty / 2 : qty;
    const order = { id: `ord-${this.orders.length}`, clientId, side, qty, filled, status: filled === qty ? "filled" as const : "partial" as const, price };
    this.orders.push(order);
    this.position += side === "buy" ? filled : -filled;
    this.cash += side === "buy" ? -filled * price : filled * price;
    return order;
  }
}
