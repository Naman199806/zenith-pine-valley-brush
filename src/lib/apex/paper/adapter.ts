import { readFileSync, writeFileSync } from "node:fs";
import { exitBeforeSubmit, reconcileExit } from "./exit.ts";

const ORDERS = "/tmp/apex-adapter-orders.json";

export function submitExit(owned: number, writesEnabled: boolean): { clientId: string; submitted: boolean } {
  const intent = exitBeforeSubmit(owned);
  if (!writesEnabled) return { clientId: intent.clientId, submitted: false };
  const orders = [{ clientId: intent.clientId, qty: owned, side: "sell" }];
  writeFileSync(ORDERS, JSON.stringify(orders));
  return { clientId: intent.clientId, submitted: true };
}

export function mockFill(): { owned: number; orders: number } {
  const orders = JSON.parse(readFileSync(ORDERS, "utf8")) as { clientId: string }[];
  if (orders.length !== 1) throw new Error("expected one sell");
  const done = reconcileExit(true);
  return { owned: done.owned, orders: orders.length };
}
