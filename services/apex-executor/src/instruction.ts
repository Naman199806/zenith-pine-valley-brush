/**
 * Typed handoff. Caller booleans are not approval.
 * Operator proof is verified against APEX_OPERATOR_SECRET.
 * CONNECTIVITY_TEST still requires that proof. STRATEGY_TRADE stays blocked.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

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
  sizedNotional: number;
  category: ExecutionCategory;
  nonce: string;
  operatorProof: string | null;
  exitAuthorizationId: string | null;
}

export function instructionMaterial(msg: TradeInstruction): string {
  return [msg.symbol, msg.side, msg.orderType, msg.timeInForce, String(msg.qty), String(msg.limitPrice), msg.session, msg.clientOrderId, msg.expiresAt, msg.nonce].join("|");
}

export function verifyOperatorProof(msg: TradeInstruction, secret: string | null, now = Date.now()): string | null {
  if (msg.category === "STRATEGY_TRADE" || msg.strategyApproved !== false) return "STRATEGY_TRADE blocked";
  if (!secret) return "operator secret missing; research cannot mint approval";
  if (!msg.operatorProof) return "operator proof required";
  if (Date.parse(msg.expiresAt) <= now) return "instruction expired";
  const expected = createHmac("sha256", secret).update(instructionMaterial(msg)).digest("hex");
  const a = Buffer.from(msg.operatorProof);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return "operator proof mismatch";
  return null;
}

export function validateShape(msg: TradeInstruction): string | null {
  if (!msg.decisionId || !msg.clientOrderId || !msg.nonce) return "missing identity";
  if (msg.orderType !== "limit" || msg.session !== "REGULAR" || msg.timeInForce !== "day") return "limit day regular required";
  if (!(msg.qty > 0) || !Number.isFinite(msg.qty) || !(msg.limitPrice > 0) || !Number.isFinite(msg.limitPrice)) return "quantity or limit invalid";
  if (msg.side === "buy" && msg.qty * msg.limitPrice * 1.001 > 25) return "worst-case entry exceeds $25";
  if (msg.side === "sell" && !msg.exitAuthorizationId) return "separate sell authorization required";
  return null;
}
