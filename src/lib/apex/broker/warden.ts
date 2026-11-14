import { randomUUID } from "node:crypto";

const seen = new Set<string>();

export interface WardenEvent {
  event_id: string;
  timestamp: string;
  event_type: string;
  strategy_id: string;
  metadata: Record<string, string | number | boolean | null>;
}

export interface WardenResult {
  ok: boolean;
  httpStatus: number | null;
  acknowledged: boolean;
  processed: boolean;
  body: unknown;
  error?: string;
}

export function buildReconciliationEvent(meta: Record<string, string | number | boolean | null>): WardenEvent {
  return {
    event_id: "warden-" + randomUUID(),
    timestamp: new Date().toISOString(),
    event_type: "ACCOUNT_RECONCILIATION_REQUEST",
    strategy_id: "fmz-bollinger-rsi-long-v1",
    metadata: meta,
  };
}

export async function postWarden(url: string, key: string, event: WardenEvent, timeoutMs = 8000): Promise<WardenResult> {
  if (seen.has(event.event_id)) return { ok: false, httpStatus: null, acknowledged: false, processed: false, body: null, error: "duplicate event_id" };
  seen.add(event.event_id);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + key },
      body: JSON.stringify(event),
      signal: controller.signal,
    });
    const text = await res.text();
    let body: unknown = text;
    try { body = JSON.parse(text); } catch { /* keep text */ }
    return { ok: res.ok, httpStatus: res.status, acknowledged: res.ok, processed: false, body };
  } catch (err) {
    return { ok: false, httpStatus: null, acknowledged: false, processed: false, body: null, error: err instanceof Error ? err.message : "request failed" };
  } finally {
    clearTimeout(timer);
  }
}
