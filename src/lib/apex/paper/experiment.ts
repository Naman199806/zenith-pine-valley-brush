export const PAPER_BASE = "https://paper-api.alpaca.markets";
export const EXPERIMENT_ON = false;

export interface ExperimentGate {
  symbol: string;
  maxNotional: number;
  operatorApproved: boolean;
  expires: string;
}

export function canSubmit(gate: ExperimentGate, now = "2026-11-13"): string {
  if (!EXPERIMENT_ON) return "BLOCKED_EXPERIMENT_OFF";
  if (!gate.operatorApproved) return "BLOCKED_NO_OPERATOR";
  if (gate.maxNotional > 100) return "BLOCKED_NOTIONAL";
  if (gate.expires < now) return "BLOCKED_EXPIRED";
  if (gate.symbol !== "BTC/USD" && gate.symbol !== "SPY") return "BLOCKED_SYMBOL";
  return "ALLOWED";
}
