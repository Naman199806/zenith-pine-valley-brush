export type AgentStance = "SUPPORT" | "DEFER" | "REJECT" | "UNAVAILABLE";

export interface AgentReview {
  stance: AgentStance;
  evidenceId: string | null;
  asOf: string | null;
}

export interface Decision {
  instrument: string;
  action: "BUY" | "SELL" | "HOLD" | "NO_TRADE";
  reason: string;
  quantRejects: boolean;
  riskRejects: boolean;
  agentChanged: boolean;
}

export function decide(input: {
  instrument: string;
  quantOk: boolean;
  riskOk: boolean;
  strategyApproved: boolean;
  agent?: AgentReview;
}): Decision {
  if (!input.quantOk) return { instrument: input.instrument, action: "NO_TRADE", reason: "Quant rejected.", quantRejects: true, riskRejects: !input.riskOk, agentChanged: false };
  if (!input.riskOk) return { instrument: input.instrument, action: "NO_TRADE", reason: "Risk rejected.", quantRejects: false, riskRejects: true, agentChanged: false };
  if (!input.strategyApproved) return { instrument: input.instrument, action: "NO_TRADE", reason: "No approved strategy.", quantRejects: false, riskRejects: false, agentChanged: false };
  const stance = input.agent?.stance ?? "UNAVAILABLE";
  if (stance === "REJECT" || stance === "DEFER" || stance === "UNAVAILABLE") {
    return { instrument: input.instrument, action: "NO_TRADE", reason: `Agent ${stance}.`, quantRejects: false, riskRejects: false, agentChanged: true };
  }
  return { instrument: input.instrument, action: "HOLD", reason: "Eligible and agent supports. Still not an order.", quantRejects: false, riskRejects: false, agentChanged: true };
}
