import { readFileSync, writeFileSync } from "node:fs";

export type OrderState = "SUBMITTING" | "ACKNOWLEDGED" | "PARTIALLY_FILLED" | "FILLED" | "REJECTED" | "CANCELLED" | "UNKNOWN";

export interface Intent {
  clientId: string;
  state: OrderState;
  qty: number;
  newEntries: boolean;
}

const PATH = "/tmp/apex-unknown.json";

export function intentBeforeSubmit(): Intent {
  const intent: Intent = { clientId: "mock-unknown-1", state: "SUBMITTING", qty: 0.001, newEntries: false };
  writeFileSync(PATH, JSON.stringify(intent));
  return intent;
}

export function lostResponse(): Intent {
  const intent = JSON.parse(readFileSync(PATH, "utf8")) as Intent;
  intent.state = "UNKNOWN";
  intent.newEntries = false;
  writeFileSync(PATH, JSON.stringify(intent));
  return intent;
}

export function reconcile(brokerHasOrder: boolean): Intent {
  const intent = JSON.parse(readFileSync(PATH, "utf8")) as Intent;
  if (intent.clientId !== "mock-unknown-1") throw new Error("id changed");
  intent.state = brokerHasOrder ? "ACKNOWLEDGED" : "UNKNOWN";
  intent.newEntries = intent.state !== "UNKNOWN";
  writeFileSync(PATH, JSON.stringify(intent));
  return intent;
}

export function reload(): Intent {
  return JSON.parse(readFileSync(PATH, "utf8")) as Intent;
}
