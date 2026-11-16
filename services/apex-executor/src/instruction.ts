/**
 * Typed handoff from Apex Quant X to Apex Executor.
 * The research process cannot mint approval or hold order-writing credentials.
 */

export type ExecutionCategory = "CONNECTIVITY_TEST" | "STRATEGY_TRADE";
export type Side = "buy" | "sell";

export interface TradeInstruction {
  decisionId: string;
  clientOrderId: string;
  strategyId: string;
  strategyVersion: string;
  strategyApproved: false;
  symbol: "SPY" | "QQQ" | "IWM";
  side: Side;
  orderType: "limit";
  qty: number;
  limitPrice: number;
  session: "REGULAR";
  timeInForce: "day";
  expiresAt: string;
  evidenceTimestamp: string;
  sigmaApproved: boolean;
  sentinelApproved: boolean;
  sizedNotional: number;
  category: ExecutionCategory;
  authorizationRef: string | null;
  nonce: string;
}

export function validateInstruction(msg: TradeInstruction, now = Date.now()): string | null {
  if (!msg.decisionId || !msg.clientOrderId || !msg.nonce) return "missing identity";
  if (msg.strategyApproved !== false) return "strategy approval cannot be asserted by research";
  if (msg.category === "STRATEGY_TRADE") return "STRATEGY_TRADE blocked while strategyApproved=false";
  if (msg.orderType !== "limit" || msg.session !== "REGULAR" || msg.timeInForce !== "day") return "limit day regular required";
  if (!(msg.qty > 0) || !Number.isFinite(msg.qty) || !(msg.limitPrice > 0) || !Number.isFinite(msg.limitPrice)) return "quantity or limit invalid";
  if (msg.side === "buy" && msg.qty * msg.limitPrice * 1.001 > 25) return "worst-case entry exceeds $25";
  if (!msg.sigmaApproved || !msg.sentinelApproved) return "Sigma or Sentinel veto";
  if (Date.parse(msg.expiresAt) <= now) return "instruction expired";
  if (!msg.authorizationRef) return "operator authorization reference required";
  return null;
}
