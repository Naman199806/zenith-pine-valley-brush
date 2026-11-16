/**
 * Research-side proposal. Explicitly non-executable.
 * Quantity is never invented from an assumed price.
 */

import { createHash } from "node:crypto";
import type { DecisionTrace } from "./canonical-decision.ts";

export interface ResearchProposal {
  v: 1;
  source: "RESEARCH_PROPOSAL";
  executable: false;
  decisionId: string;
  strategyId: string;
  strategyVersion: string;
  strategyApproved: false;
  symbol: string;
  side: "buy" | "sell" | null;
  orderType: "limit" | null;
  qty: null;
  limitPrice: null;
  session: "REGULAR";
  timeInForce: "day" | null;
  dataAsOf: string;
  validUntil: string | null;
  nonce: string;
  category: "CONNECTIVITY_TEST";
  recommendation: "BUY" | "EXIT" | "NO_TRADE";
  sigmaVeto: boolean;
  sentinelVeto: boolean;
  sizedNotional: number | null;
  provenance: string;
  executionAuthorized: false;
  operatorProof: null;
}

export function decisionId(trace: DecisionTrace): string {
  return createHash("sha256").update(`${trace.strategyVersion}|${trace.symbol}|${trace.asOf}|${trace.researchRecommendation}|${trace.provenance}`).digest("hex").slice(0, 16);
}

export function buildProposal(trace: DecisionTrace, sizedNotional: number | null = null, validForMs = 15 * 60 * 1000): ResearchProposal {
  const actionable = trace.researchRecommendation !== "NO_TRADE";
  const asOfMs = Date.parse(trace.asOf);
  return {
    v: 1,
    source: "RESEARCH_PROPOSAL",
    executable: false,
    decisionId: decisionId(trace),
    strategyId: trace.strategyVersion,
    strategyVersion: trace.strategyVersion,
    strategyApproved: false,
    symbol: trace.symbol,
    side: trace.researchRecommendation === "BUY" ? "buy" : trace.researchRecommendation === "EXIT" ? "sell" : null,
    orderType: actionable ? "limit" : null,
    qty: null,
    limitPrice: null,
    session: "REGULAR",
    timeInForce: actionable ? "day" : null,
    dataAsOf: trace.asOf,
    validUntil: actionable && Number.isFinite(asOfMs) ? new Date(asOfMs + validForMs).toISOString() : null,
    nonce: decisionId(trace),
    category: "CONNECTIVITY_TEST",
    recommendation: trace.researchRecommendation,
    sigmaVeto: trace.quantRejects,
    sentinelVeto: trace.riskRejects,
    sizedNotional: actionable ? sizedNotional : null,
    provenance: trace.provenance,
    executionAuthorized: false,
    operatorProof: null,
  };
}
