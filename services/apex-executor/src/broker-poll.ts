/**
 * Broker-poll telemetry. Failure kinds and reconciliation outcomes are enums.
 * Nothing in this module accepts response bodies, headers, URLs, or secrets.
 * Freshness is computed by the caller from this process's full-success clock.
 * A timestamp restored from disk is not a full success.
 */

export const BROKER_POLL_INTERVAL_MS = 1_000;

/** Existing execution evidence window. staleAfterMs cannot extend it. */
export const MARKET_EVIDENCE_MAX_AGE_MS = 5_000;

export const FAILURE_KINDS = ["auth", "network", "timeout", "http", "parse", "reconcile"] as const;
export type BrokerPollFailureKind = (typeof FAILURE_KINDS)[number];

export const RECONCILE_OUTCOMES = ["OK", "MISMATCH", "UNKNOWN_ORDERS", "NOT_RUN", "FAILED"] as const;
export type ReconciliationOutcome = (typeof RECONCILE_OUTCOMES)[number];

export interface ReconciliationReport {
  outcome: ReconciliationOutcome;
  outstandingOrders: number;
  unknownOrders: number;
}

export interface BrokerPollState {
  lastAttemptAt: string | null;
  lastSnapshotOkAt: string | null;
  lastReconcileOkAt: string | null;
  lastFullSuccessAt: string | null;
  lastFailureAt: string | null;
  lastFailureKind: BrokerPollFailureKind | null;
  consecutiveFailures: number;
  reconciliation: ReconciliationReport;
}

export interface BrokerPollHealth extends BrokerPollState {
  freshnessMs: number | null;
  staleAfterMs: number;
  stale: boolean;
}

export function defaultStaleAfterMs(pollIntervalMs = BROKER_POLL_INTERVAL_MS): number {
  return pollIntervalMs * 5;
}

export function readStaleAfterMs(env: NodeJS.ProcessEnv, pollIntervalMs = BROKER_POLL_INTERVAL_MS): number {
  const raw = env.APEX_EXECUTOR_STALE_AFTER_MS;
  if (raw == null || raw.trim() === "") return defaultStaleAfterMs(pollIntervalMs);
  if (!/^\d+$/.test(raw.trim())) throw new Error("APEX_EXECUTOR_STALE_AFTER_MS must be a positive integer");
  const value = Number(raw.trim());
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("APEX_EXECUTOR_STALE_AFTER_MS must be a positive integer");
  return value;
}

/** Configured threshold, capped so it cannot outlive the existing 5s evidence rule. */
export function effectiveStaleAfterMs(configured: number): number {
  if (!Number.isSafeInteger(configured) || configured <= 0) throw new Error("APEX_EXECUTOR_STALE_AFTER_MS must be a positive integer");
  return Math.min(configured, MARKET_EVIDENCE_MAX_AGE_MS);
}

export function blankBrokerPoll(): BrokerPollState {
  return {
    lastAttemptAt: null,
    lastSnapshotOkAt: null,
    lastReconcileOkAt: null,
    lastFullSuccessAt: null,
    lastFailureAt: null,
    lastFailureKind: null,
    consecutiveFailures: 0,
    reconciliation: { outcome: "NOT_RUN", outstandingOrders: 0, unknownOrders: 0 },
  };
}

export function classifyHttpStatus(status: number): BrokerPollFailureKind | null {
  if (status === 200) return null;
  if (status === 401 || status === 403) return "auth";
  return "http";
}

export function classifyThrown(error: unknown): BrokerPollFailureKind {
  const name = error instanceof Error ? error.name : "";
  const code = typeof error === "object" && error != null && "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  const message = error instanceof Error ? error.message : "";
  if (name === "TimeoutError" || name === "AbortError" || code === "ETIMEDOUT" || code === "ABORT_ERR" || /timeout|timed out/i.test(message)) {
    return "timeout";
  }
  if (name === "SyntaxError" || /unexpected token|not valid json/i.test(message)) return "parse";
  return "network";
}

export function unknownBrokerOrderCount(openOrders: readonly unknown[], knownIds: ReadonlySet<string>): number {
  let count = 0;
  for (const row of openOrders) {
    if (!row || typeof row !== "object") continue;
    const id = (row as { client_order_id?: unknown }).client_order_id;
    if (typeof id !== "string" || id.length === 0) continue;
    if (!knownIds.has(id)) count += 1;
  }
  return count;
}

function corrupt(): never {
  throw new Error("executor state corrupt; fail closed");
}

/** Restore failure history only. Success timestamps are ignored on purpose. */
export function readPersistedPoll(value: unknown): { lastFailureAt: string | null; lastFailureKind: BrokerPollFailureKind | null; consecutiveFailures: number } | null {
  if (value == null) return null;
  if (typeof value !== "object") corrupt();
  const row = value as Record<string, unknown>;
  for (const field of ["lastAttemptAt", "lastSnapshotOkAt", "lastReconcileOkAt", "lastFullSuccessAt", "lastFailureAt"] as const) {
    const item = row[field];
    if (item != null && typeof item !== "string") corrupt();
  }
  if (row.lastFailureKind != null && (typeof row.lastFailureKind !== "string" || !FAILURE_KINDS.includes(row.lastFailureKind as BrokerPollFailureKind))) corrupt();
  if (row.consecutiveFailures != null && (typeof row.consecutiveFailures !== "number" || !Number.isInteger(row.consecutiveFailures) || row.consecutiveFailures < 0)) corrupt();
  if (row.reconciliation != null) {
    if (typeof row.reconciliation !== "object") corrupt();
    const outcome = (row.reconciliation as { outcome?: unknown }).outcome;
    if (outcome != null && (typeof outcome !== "string" || !RECONCILE_OUTCOMES.includes(outcome as ReconciliationOutcome))) corrupt();
  }
  return {
    lastFailureAt: typeof row.lastFailureAt === "string" ? row.lastFailureAt : null,
    lastFailureKind: typeof row.lastFailureKind === "string" ? (row.lastFailureKind as BrokerPollFailureKind) : null,
    consecutiveFailures: typeof row.consecutiveFailures === "number" ? row.consecutiveFailures : 0,
  };
}
