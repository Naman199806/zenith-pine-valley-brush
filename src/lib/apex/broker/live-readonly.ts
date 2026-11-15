export const LIVE_ORIGIN = "https://api.alpaca.markets";

export interface LiveReadOnly {
  mode: "LIVE_READ_ONLY";
  canSubmit: false;
  activated: false;
  requiredAuthorization: string[];
}

export function prepareLiveReadOnly(): LiveReadOnly {
  return {
    mode: "LIVE_READ_ONLY",
    canSubmit: false,
    activated: false,
    requiredAuthorization: [
      "separate live account read authorization",
      "exact instrument and maximum notional",
      "broker-confirmed close path tested on paper first",
      "emergency close procedure acknowledged",
      "LIVE remains false until a later explicit order authorization",
    ],
  };
}

export function assertLiveReadOnly(url: string): void {
  const parsed = new URL(url);
  if (parsed.hostname !== "api.alpaca.markets") throw new Error("not the live read-only host");
  if (parsed.pathname.includes("/orders") && parsed.searchParams.get("status") == null && !parsed.pathname.includes(":by_client_order_id")) {
    throw new Error("live order submission path is blocked");
  }
}
