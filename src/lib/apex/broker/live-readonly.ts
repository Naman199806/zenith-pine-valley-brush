export const LIVE_ORIGIN = "https://api.alpaca.markets";
const ALLOWED = [/^\/v2\/account$/, /^\/v2\/positions$/, /^\/v2\/orders$/, /^\/v2\/orders:by_client_order_id$/, /^\/v2\/clock$/, /^\/v2\/assets\/.+$/];

export interface LiveReadOnlyTransport {
  get(url: string): Promise<{ status: number; body: unknown }>;
}

export function prepareLiveReadOnly() {
  return {
    mode: "LIVE_READ_ONLY" as const,
    canSubmit: false as const,
    activated: false as const,
    method: "GET" as const,
    credentialEnv: ["LIVE_APCA_API_KEY_ID", "LIVE_APCA_API_SECRET_KEY"],
    requiredAuthorization: [
      "separate live account read authorization",
      "exact instrument and maximum notional",
      "broker-confirmed close path tested on paper first",
      "emergency close procedure acknowledged",
      "LIVE remains false until a later explicit order authorization",
    ],
  };
}

export function assertLiveReadOnly(url: string, method = "GET"): void {
  if (method !== "GET") throw new Error("live read-only transport is GET only");
  const parsed = new URL(url);
  if (parsed.hostname !== "api.alpaca.markets") throw new Error("not the live read-only host");
  if (!ALLOWED.some((pattern) => pattern.test(parsed.pathname))) throw new Error("live endpoint not allowlisted");
  if (parsed.pathname === "/v2/orders" && parsed.searchParams.get("status") == null) throw new Error("live order submission path is blocked");
}
