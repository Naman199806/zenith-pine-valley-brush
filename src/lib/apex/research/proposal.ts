/**
 * Research-side proposal. Not an operator signature and not an order.
 * Compatible with the Executor v1 field set. Cursor owns verification.
 */

import { createHash, randomUUID } from "node:crypto";
import type { DecisionTrace } from "./canonical-decision.ts";

export interface ResearchProposal {
  v: 1;
  source: "RESEARCH_PROPOSAL";
  decisionId: string;
  strategyId: string;
  strategyVersion: string;
  strategyApproved: false;
  symbol: string;
  side: "buy" | "sell" | null;
  orderType: "limit";
  qty: number | null;
  limitPrice: null;
  session: "REGULAR";
  timeInForce: "day";
  expiresAt: string;
  nonce: string;
  category: "CONNECTIVITY_TEST";
  recommendation: "BUY" | "EXIT" | "NO_TRADE";
  sigmaVeto: boolean;
  sentinelVeto: boolean;
  sizedNotional: number;
  provenance: string;
  asOf: string;
  executionAuthorized: false;
  operatorProof: null;
}

export function buildProposal(trace: DecisionTrace, sizedNotional = 25): ResearchProposal {
  const side = trace.researchRecommendation === "BUY" ? "buy" : trace.researchRecommendation === "EXIT" ? "sell" : null;
  const decisionId = createHash("sha256").update(`${trace.strategyVersion}|${trace.symbol}|${trace.asOf}|${trace.researchRecommendation}`).digest("hex").slice(0, 16);
  return {
    v: 1,
    source: "RESEARCH_PROPOSAL",
    decisionId,
    strategyId: trace.strategyVersion,
    strategyVersion: trace.strategyVersion,
    strategyApproved: false,
    symbol: trace.symbol,
    side,
    orderType: "limit",
    qty: side ? Math.floor((Math.min(25, sizedNotional) / 100) * 1000) / 1000 : null,
    limitPrice: null,
    session: "REGULAR",
    timeInForce: "day",
    expiresAt: trace.asOf,
    nonce: randomUUID(),
    category: "CONNECTIVITY_TEST",
    recommendation: trace.researchRecommendation,
    sigmaVeto: trace.quantRejects,
    sentinelVeto: trace.riskRejects,
    sizedNotional: Math.min(25, sizedNotional),
    provenance: trace.provenance,
    asOf: trace.asOf,
    executionAuthorized: false,
    operatorProof: null,
  };
}
