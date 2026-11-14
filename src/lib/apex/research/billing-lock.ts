import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const BILLING_CODE = "personal-team-blocked:spending-limit";

export interface BillingLock {
  status: "PROVIDER_BILLING_BLOCKED";
  reason: "spending-limit";
  providerCode: string;
  lockedAt: string;
  agentId: string;
  runId: string;
  clearedAt?: string;
  billingConfirmed?: string;
  authorizationId?: string;
}

export function isSpendingLimit(status: number, body: string): boolean {
  return status === 402 && body.includes(BILLING_CODE);
}

export function loadLock(path: string): BillingLock | null {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}

export function tripLock(path: string, input: { agentId: string; runId: string; providerCode?: string; at?: string }): BillingLock {
  const lock: BillingLock = {
    status: "PROVIDER_BILLING_BLOCKED",
    reason: "spending-limit",
    providerCode: input.providerCode || BILLING_CODE,
    lockedAt: input.at || new Date().toISOString(),
    agentId: input.agentId,
    runId: input.runId,
  };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(lock, null, 2));
  return lock;
}

export function paidRequestsBlocked(path: string): boolean {
  const lock = loadLock(path);
  return Boolean(lock && lock.status === "PROVIDER_BILLING_BLOCKED" && !lock.clearedAt);
}

export function clearLock(path: string, input: { billingConfirmed: string; authorizationId: string; at?: string }): { ok: boolean; reason: string } {
  const lock = loadLock(path);
  if (!lock) return { ok: false, reason: "no lock" };
  if (!input.billingConfirmed || !input.authorizationId) return { ok: false, reason: "both clearances required" };
  if (input.billingConfirmed !== "MANUAL_BILLING_CONFIRMED") return { ok: false, reason: "billing confirmation missing" };
  if (!input.authorizationId.startsWith("auth-")) return { ok: false, reason: "fresh authorization missing" };
  lock.clearedAt = input.at || new Date().toISOString();
  lock.billingConfirmed = input.billingConfirmed;
  lock.authorizationId = input.authorizationId;
  writeFileSync(path, JSON.stringify(lock, null, 2));
  return { ok: true, reason: "cleared" };
}
