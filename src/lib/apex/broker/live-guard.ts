export function assertOrderEndpoint(url: string): void {
  const host = new URL(url).hostname;
  if (host === "api.alpaca.markets") throw new Error("LIVE endpoint blocked");
  if (host !== "paper-api.alpaca.markets") throw new Error("non-paper trading endpoint blocked");
}

export function liveReadiness(): { liveIntegration: "NOT_VERIFIED"; microLive: "NO-GO"; autonomousLive: "NO-GO"; reason: string } {
  return { liveIntegration: "NOT_VERIFIED", microLive: "NO-GO", autonomousLive: "NO-GO", reason: "no verified edge and no unattended exit proof" };
}
