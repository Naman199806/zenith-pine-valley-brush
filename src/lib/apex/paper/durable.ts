import { readFileSync, writeFileSync } from "node:fs";

export interface ExpState {
  id: string;
  status: "FLAT" | "OPEN" | "CLOSING" | "UNKNOWN";
  clientId: string | null;
  qty: number;
  entry: number | null;
  exitRule: string;
}

const PATH = "/tmp/apex-exp-state.json";

export function save(state: ExpState): void {
  writeFileSync(PATH, JSON.stringify(state));
}

export function load(): ExpState | null {
  try {
    return JSON.parse(readFileSync(PATH, "utf8")) as ExpState;
  } catch {
    return null;
  }
}

export function openPosition(): ExpState {
  const state: ExpState = { id: "exp-1", status: "OPEN", clientId: "mock-exp-1", qty: 0.001, entry: 70000, exitRule: "operator-supervised market sell" };
  save(state);
  return state;
}

export function recover(): ExpState {
  const state = load();
  if (!state) return { id: "exp-1", status: "UNKNOWN", clientId: null, qty: 0, entry: null, exitRule: "block-new-entries" };
  return state;
}

export function closeRecovered(): ExpState {
  const state = recover();
  if (state.status !== "OPEN") return state;
  const closed: ExpState = { ...state, status: "FLAT", qty: 0 };
  save(closed);
  return closed;
}
