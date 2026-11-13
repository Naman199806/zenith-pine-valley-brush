import { readFileSync, writeFileSync } from "node:fs";

export interface ExitIntent {
  clientId: string;
  state: "SUBMITTING" | "UNKNOWN" | "FILLED";
  owned: number;
  sellQty: number;
}

const PATH = "/tmp/apex-exit.json";

export function exitBeforeSubmit(owned: number): ExitIntent {
  const intent: ExitIntent = { clientId: "mock-exit-1", state: "SUBMITTING", owned, sellQty: owned };
  writeFileSync(PATH, JSON.stringify(intent));
  return intent;
}

export function lostExitAck(): ExitIntent {
  const intent = JSON.parse(readFileSync(PATH, "utf8")) as ExitIntent;
  intent.state = "UNKNOWN";
  writeFileSync(PATH, JSON.stringify(intent));
  return intent;
}

export function reloadExit(): ExitIntent {
  return JSON.parse(readFileSync(PATH, "utf8")) as ExitIntent;
}

export function reconcileExit(brokerFilled: boolean): ExitIntent {
  const intent = reloadExit();
  if (intent.clientId !== "mock-exit-1") throw new Error("id changed");
  if (!brokerFilled) return intent;
  intent.state = "FILLED";
  intent.owned = 0;
  writeFileSync(PATH, JSON.stringify(intent));
  return intent;
}
