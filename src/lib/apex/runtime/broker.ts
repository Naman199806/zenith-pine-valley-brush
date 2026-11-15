export interface BrokerRead {
  ok: boolean;
  status: number;
  body: unknown;
  error: string | null;
}

export function classifyBrokerResponse(status: number, text: string): BrokerRead {
  let body: unknown = null;
  let parsed = false;
  try {
    body = text ? JSON.parse(text) : null;
    parsed = true;
  } catch {
    parsed = false;
  }
  if (status < 200 || status >= 300) {
    return { ok: false, status, body, error: `status=${status} body=${text.slice(0, 180).replace(/\s+/g, " ")}` };
  }
  if (!parsed) return { ok: false, status, body: null, error: `malformed status=${status} body=${text.slice(0, 180).replace(/\s+/g, " ")}` };
  return { ok: true, status, body, error: null };
}

export function staleCandleError(lastBar: string | null, nowMs = Date.now(), maxAgeMs = 20 * 60 * 1000): string | null {
  if (!lastBar) return "stale market data: no completed candle";
  const age = nowMs - Date.parse(lastBar);
  if (!Number.isFinite(age) || age > maxAgeMs) return `stale market data: lastBar=${lastBar}`;
  return null;
}
