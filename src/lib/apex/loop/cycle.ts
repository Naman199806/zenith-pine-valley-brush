import type { AgentReview } from "../research/decide.ts";
import { decide } from "../research/decide.ts";

export type Proposal = "BUY" | "SELL" | "HOLD" | "NO_TRADE";

export interface Cycle {
  instrument: string;
  proposal: Proposal;
  reason: string;
  paperAuto: false;
  orderSent: false;
  agentChanged: boolean;
}

export function cycle(instrument: string, quantOk: boolean, strategyApproved: boolean, agent?: AgentReview): Cycle {
  const decision = decide({ instrument, quantOk, riskOk: true, strategyApproved, agent });
  return { instrument, proposal: decision.action, reason: decision.reason, paperAuto: false, orderSent: false, agentChanged: decision.agentChanged };
}