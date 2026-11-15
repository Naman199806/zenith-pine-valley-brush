import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";

export interface JournalEvent {
  journalId: string;
  traceId: string;
  at: string;
  type: "INTENT" | "ACK" | "FILL" | "PARTIAL" | "REJECT" | "TIMEOUT" | "STOP_REJECTED" | "EXIT" | "RECOVERY" | "ALERT";
  clientOrderId: string | null;
  detail: Record<string, unknown>;
}

export interface OrderIntent {
  clientOrderId: string;
  traceId: string;
  side: "buy" | "sell";
  qty: number;
  price: number;
  state: "INTENT" | "SUBMITTED" | "UNKNOWN" | "FILLED" | "PARTIAL" | "REJECTED" | "EXITED";
  createdAt: string;
}

export interface SafetyState {
  entriesBlocked: boolean;
  alert: string | null;
  intents: OrderIntent[];
  journal: JournalEvent[];
  position: number;
  cash: number;
}

export function emptySafety(cash = 1000): SafetyState {
  return { entriesBlocked: false, alert: null, intents: [], journal: [], position: 0, cash };
}

export function persist(path: string, state: SafetyState): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2));
}

export function load(path: string): SafetyState {
  if (!existsSync(path)) return emptySafety();
  return JSON.parse(readFileSync(path, "utf8"));
}

function add(state: SafetyState, event: Omit<JournalEvent, "at"> & { at?: string }): SafetyState {
  state.journal.push({ ...event, at: event.at ?? new Date().toISOString() });
  return state;
}

export function recordIntent(state: SafetyState, intent: OrderIntent): SafetyState {
  if (state.intents.some((i) => i.clientOrderId === intent.clientOrderId)) throw new Error("duplicate client order id");
  if (state.entriesBlocked && intent.side === "buy") throw new Error("new entries blocked");
  state.intents.push(intent);
  return add(state, { journalId: `j-${state.journal.length + 1}`, traceId: intent.traceId, type: "INTENT", clientOrderId: intent.clientOrderId, detail: { side: intent.side, qty: intent.qty } });
}

export function applyFill(state: SafetyState, clientOrderId: string, filled: number, price: number, partial = false): SafetyState {
  const intent = state.intents.find((i) => i.clientOrderId === clientOrderId);
  if (!intent) throw new Error("unknown intent");
  intent.state = partial ? "PARTIAL" : "FILLED";
  state.position += intent.side === "buy" ? filled : -filled;
  state.cash += intent.side === "buy" ? -filled * price : filled * price;
  return add(state, { journalId: `j-${state.journal.length + 1}`, traceId: intent.traceId, type: partial ? "PARTIAL" : "FILL", clientOrderId, detail: { filled, price, position: state.position, cash: state.cash } });
}

export function rejectStop(state: SafetyState, clientOrderId: string): SafetyState {
  const intent = state.intents.find((i) => i.clientOrderId === clientOrderId);
  if (intent) intent.state = "REJECTED";
  state.entriesBlocked = true;
  state.alert = "protective stop rejected; new entries blocked";
  return add(state, { journalId: `j-${state.journal.length + 1}`, traceId: intent?.traceId ?? "unknown", type: "STOP_REJECTED", clientOrderId, detail: { alert: state.alert, entriesBlocked: true } });
}

export function recover(path: string): SafetyState {
  const state = load(path);
  add(state, { journalId: `j-${state.journal.length + 1}`, traceId: "restart", type: "RECOVERY", clientOrderId: null, detail: { intents: state.intents.length, position: state.position, entriesBlocked: state.entriesBlocked } });
  persist(path, state);
  return state;
}

export function assertProductionIsolation(config: { fixtureApproval?: boolean; strategyApproved?: boolean; LIVE?: boolean }): void {
  if (config.fixtureApproval) throw new Error("fixtureApproval cannot be set in production runtime");
  if (config.strategyApproved) throw new Error("strategyApproved cannot be set by this runtime");
  if (config.LIVE) throw new Error("LIVE cannot be enabled by this runtime");
}
