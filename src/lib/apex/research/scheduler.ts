import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { ROLES } from "./protocol.ts";
import { sendMock, resetAccounting, type TransportRequest } from "./transport.ts";
import { decide } from "./decide.ts";
import { paidRequestsBlocked } from "./billing-lock.ts";

export interface CycleRecord {
  cycleId: string;
  runId: string;
  action: "NO_TRADE" | "HOLD" | "BUY" | "SELL";
  roles: number;
  paid: false;
  brokerWrites: 0;
  blocked?: string;
}

export function loadState(path: string): { cycles: CycleRecord[] } {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : { cycles: [] };
}

export function saveState(path: string, state: { cycles: CycleRecord[] }) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2));
}

export async function runCycle(cycleId: string, fetchImpl: typeof fetch, path: string, lockPath?: string): Promise<CycleRecord> {
  const prior = loadState(path);
  if (prior.cycles.some((cycle) => cycle.cycleId === cycleId)) return prior.cycles.find((cycle) => cycle.cycleId === cycleId)!;
  if (lockPath && paidRequestsBlocked(lockPath)) {
    const decision = decide({ instrument: "BTC/USD", quantOk: true, riskOk: true, strategyApproved: false });
    const blocked: CycleRecord = { cycleId, runId: cycleId, action: decision.action, roles: 0, paid: false, brokerWrites: 0, blocked: "PROVIDER_BILLING_BLOCKED" };
    prior.cycles.push(blocked);
    saveState(path, prior);
    return blocked;
  }
  const results = [];
  for (const role of ROLES) {
    const input: TransportRequest = {
      model: "grok-4.3",
      runId: `${cycleId}-${role}`,
      agentId: role,
      asOfUtc: "2026-11-12T00:00:00Z",
      thesis: "descriptive research only",
      maxTokens: 200,
      observations: "completed bars only",
    };
    results.push(await sendMock(input, fetchImpl));
  }
  const decision = decide({ instrument: "BTC/USD", quantOk: true, riskOk: true, strategyApproved: false });
  const record: CycleRecord = { cycleId, runId: cycleId, action: decision.action, roles: results.length, paid: false, brokerWrites: 0 };
  prior.cycles.push(record);
  saveState(path, prior);
  return record;
}

export function reset() {
  resetAccounting();
}
