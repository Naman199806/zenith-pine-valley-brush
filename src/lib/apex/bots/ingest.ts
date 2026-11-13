export interface BotResult {
  botId: string;
  correlationId: string;
  asOf: string;
  stance: "SUPPORT" | "DEFER" | "REJECT" | "UNAVAILABLE";
  evidenceId: string | null;
  authenticated: boolean;
}

export function accept(result: BotResult, now: string): BotResult {
  if (!result.authenticated || !result.evidenceId || result.asOf > now) {
    return { ...result, stance: "UNAVAILABLE" };
  }
  return result;
}
