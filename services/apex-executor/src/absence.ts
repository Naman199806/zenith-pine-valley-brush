/**
 * Absence is not a single 404.
 *
 * Evidence that the order is present (stop, adopt, do not submit again):
 * - GET /v2/orders:by_client_order_id returns 200 with that client_order_id, or
 * - the client_order_id appears in GET /v2/orders?status=open or status=all, or
 * - a FILL activity's order_id equals a broker order id already known for it.
 *
 * Evidence that the order is absent (all of these, otherwise it stays UNKNOWN):
 * - at least `attempts` HTTP 404 responses from GET by client_order_id
 *   (the minimum is 2, so one 404 can never qualify; the default is 3),
 * - GET /v2/orders?status=open returned 200, did not list the id, and was not truncated,
 * - GET /v2/orders?status=all returned 200, did not list the id, and was not truncated,
 * - GET /v2/account/activities/FILL returned 200 and did not contain a FILL whose
 *   order_id is the known broker id (no broker id means this check cannot see a fill,
 *   so it does not by itself prove absence).
 *
 * A timeout, 429, or 5xx is not a 404 and does not count. If the attempt budget
 * or the request budget runs out first, the order stays UNKNOWN. UNKNOWN is
 * journaled, restored after restart, blocks every new client_order_id, and is
 * listed on /health. Nothing in this module submits or mints a replacement id.
 *
 * Docs:
 * - https://docs.alpaca.markets/us/reference/getorderbyclientorderid
 * - https://docs.alpaca.markets/us/reference/getallorders-1
 * - https://docs.alpaca.markets/us/docs/account-activities
 * - https://docs.alpaca.markets/us/reference/getaccountactivitiesbyactivitytype-1
 */

export const DEFAULT_ABSENCE_ATTEMPTS = 3;
export const DEFAULT_ABSENCE_BACKOFF_MS = 250;
export const ABSENCE_ATTEMPT_CAP = 5;
export const ORDER_LIST_LIMIT = 500;

export interface AbsenceProbe {
  byClientStatus: number | "error";
  openStatus: number | "error";
  allStatus: number | "error";
  fillsStatus: number | "error";
  openHit: boolean;
  allHit: boolean;
  openTruncated: boolean;
  allTruncated: boolean;
  fillHit: boolean;
}

export type AbsenceVerdict = "present" | "absent" | "unknown";

export function readAbsenceAttempts(env: NodeJS.ProcessEnv): number {
  const raw = env.APEX_EXECUTOR_ABSENCE_ATTEMPTS;
  if (raw == null || raw.trim() === "") return DEFAULT_ABSENCE_ATTEMPTS;
  if (!/^\d+$/.test(raw.trim())) return Number.POSITIVE_INFINITY;
  const value = Number(raw.trim());
  if (!Number.isInteger(value) || value < 2) return Number.POSITIVE_INFINITY;
  return Math.min(value, ABSENCE_ATTEMPT_CAP);
}

export function readAbsenceBackoffMs(env: NodeJS.ProcessEnv): number {
  const raw = env.APEX_EXECUTOR_ABSENCE_BACKOFF_MS;
  if (raw == null || raw.trim() === "") return DEFAULT_ABSENCE_BACKOFF_MS;
  if (!/^\d+$/.test(raw.trim())) return Number.POSITIVE_INFINITY;
  const value = Number(raw.trim());
  if (!Number.isInteger(value) || value < 0) return Number.POSITIVE_INFINITY;
  return value;
}

export function listHasClientOrder(body: unknown, clientOrderId: string): boolean {
  if (!Array.isArray(body)) return false;
  return body.some((row) => !!row && typeof row === "object" && (row as { client_order_id?: unknown }).client_order_id === clientOrderId);
}

export function fillsHitOrder(body: unknown, brokerOrderId: string | null): boolean {
  if (!brokerOrderId || !Array.isArray(body)) return false;
  return body.some((row) => {
    if (!row || typeof row !== "object") return false;
    const activity = row as { activity_type?: unknown; order_id?: unknown };
    return activity.activity_type === "FILL" && activity.order_id === brokerOrderId;
  });
}

export function absenceVerdict(probes: readonly AbsenceProbe[], attemptsRequired: number): AbsenceVerdict {
  if (!Number.isFinite(attemptsRequired) || attemptsRequired < 2) return "unknown";
  for (const probe of probes) {
    if (probe.byClientStatus === 200 || probe.openHit || probe.allHit || probe.fillHit) return "present";
  }
  const cleanMisses = probes.filter((probe) => probe.byClientStatus === 404 && probe.openStatus === 200 && probe.allStatus === 200 && probe.fillsStatus === 200 && !probe.openHit && !probe.allHit && !probe.openTruncated && !probe.allTruncated && !probe.fillHit);
  if (cleanMisses.length >= attemptsRequired) return "absent";
  return "unknown";
}
