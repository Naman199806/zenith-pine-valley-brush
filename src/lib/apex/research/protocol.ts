export interface AgentMessage {
  cycleId: string;
  runId: string;
  source: string;
  destination: string;
  type: "submission" | "conversation";
  timestamp: string;
  evidenceId: string;
  body: string;
}

export const ROLES = ["scout","vector","atlas","oracle","pulse","volta","bull","bear","sigma","sentinel","allocator","pilot","hermes"] as const;

export function submission(role: string, cycleId: string, evidenceId: string, body: string, timestamp = "2026-11-12T00:00:00Z", runId = cycleId): AgentMessage {
  return { cycleId, runId, source: role, destination: "decision", type: "submission", timestamp, evidenceId, body };
}

export function independentPass(cycleId: string): AgentMessage[] {
  return ROLES.map((role) => submission(role, cycleId, "btc-daily", "first-pass mock"));
}

export function discussion(cycleId: string, runId: string, bull: string, bear: string): AgentMessage[] {
  if (!bull || !bear) return [];
  return [
    { cycleId, runId, source: "bull", destination: "bear", type: "conversation", timestamp: "2026-11-12T00:05:00Z", evidenceId: "btc-daily", body: bull },
    { cycleId, runId, source: "bear", destination: "bull", type: "conversation", timestamp: "2026-11-12T00:06:00Z", evidenceId: "btc-daily", body: bear },
  ];
}

export function budget(tokens: number, limit = 2000): { ok: boolean; usd: number; paid: false } {
  const usd = Number(((tokens / 1_000_000) * 3).toFixed(4));
  return { ok: tokens <= limit, usd, paid: false };
}
