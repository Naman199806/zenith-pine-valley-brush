/**
 * Typed handoff from Apex Quant X.
 * Operator proof is the versioned approval. Sigma and Sentinel are verified
 * from the gate proof, not from caller booleans.
 */

import { verifyGateProof, type GateProof } from "../../../src/lib/apex/live/executor.ts";
import { verifyApproval, type CanonicalApproval } from "./approval.ts";

export interface TradeInstruction extends CanonicalApproval {
  decisionId: string;
  strategyId: string;
  strategyVersion: string;
  strategyApproved: false;
  evidenceTimestamp: string;
  sizedNotional: number;
  operatorProof: string | null;
  gateProof: GateProof | null;
}

export function unsignedResearchProposal(value: unknown): string | null {
  if (!value || typeof value !== "object") return "unsigned research proposal is not executable";
  const row = value as Record<string, unknown>;
  if (row.source === "RESEARCH_PROPOSAL" || row.executable === false || row.executionAuthorized === false || row.operatorProof == null) {
    return "unsigned research proposal is not executable";
  }
  return null;
}

export function verifyInstruction(msg: TradeInstruction, secrets: { operator: string | null; gate: string | null }, now = Date.now()): string | null {
  if (msg.strategyApproved !== false) return "strategy approval cannot be asserted by research";
  if (msg.category === "STRATEGY_TRADE") return "STRATEGY_TRADE blocked while strategyApproved=false";
  if (msg.category !== "CONNECTIVITY_TEST" && msg.category !== "SUPERVISED_PAPER_TEST") return "unsupported category";
  if (!msg.decisionId || !msg.strategyId || !msg.strategyVersion) return "missing identity";
  if (msg.orderType !== "limit" || msg.session !== "REGULAR" || msg.timeInForce !== "day") return "limit day regular required";
  if (!(msg.qty > 0) || !Number.isFinite(msg.qty) || !(msg.limitPrice > 0) || !Number.isFinite(msg.limitPrice)) return "quantity or limit invalid";
  if (msg.side === "buy" && (msg.qty * msg.limitPrice * 1.001 > 25 || msg.sizedNotional > 25)) return "worst-case entry exceeds $25";
  const approvalError = verifyApproval(msg, msg.operatorProof, secrets.operator, now);
  if (approvalError) return approvalError;
  const gateError = verifyGateProof(
    msg.gateProof,
    { singleUseId: msg.clientOrderId, symbol: msg.symbol, side: msg.side, qty: msg.qty, limitPrice: msg.limitPrice },
    now,
    30_000,
    secrets.gate,
  );
  if (gateError) return gateError;
  if (!msg.gateProof || msg.gateProof.sigmaVeto || !msg.gateProof.sigmaApproved) return "Sigma veto";
  if (msg.gateProof.sentinelVeto || !msg.gateProof.sentinelApproved) return "Sentinel veto";
  return null;
}
