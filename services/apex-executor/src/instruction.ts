/**
 * Signed handoff from Apex Quant X. This module only verifies.
 * Operator proofs go through paper-equity-transport. Sigma and Sentinel
 * proofs go through live/executor verifyGateProof. Nothing here mints either.
 */

import { verifyGateProof, type GateProof } from "../../../src/lib/apex/live/executor.ts";
import {
  verifyOperatorApproval,
  verifyProtectiveApproval,
  type OperatorApproval,
  type PaperLimitTicket,
  type ProtectiveApproval,
} from "../../../src/lib/apex/broker/paper-equity-transport.ts";

export { limitApprovalMaterial, postEnableMaterial, protectiveMaterial } from "../../../src/lib/apex/broker/paper-equity-transport.ts";

export type Purpose = "ENTRY" | "EXIT" | "STOP";

export interface TradeInstruction {
  decisionId: string;
  clientOrderId: string;
  strategyId: string;
  strategyVersion: string;
  strategyApproved: false;
  symbol: "SPY";
  side: "buy" | "sell";
  orderType: "limit" | "stop" | "stop_limit";
  purpose: Purpose;
  qty: number;
  limitPrice: number;
  stopPrice: number | null;
  session: "REGULAR";
  timeInForce: "day";
  expiresAt: string;
  nonce: string;
  evidenceTimestamp: string;
  category: "CONNECTIVITY_TEST";
  sizedNotional: number;
  authorizationRef: string;
  linkedEntryId: string | null;
  approval: OperatorApproval | ProtectiveApproval;
  gateProof: GateProof;
}

const ID = /^[A-Za-z0-9-]{1,48}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function paperTicket(instruction: TradeInstruction): PaperLimitTicket {
  return {
    symbol: "SPY",
    side: instruction.side,
    orderType: "limit",
    timeInForce: "day",
    qty: instruction.qty,
    limitPrice: instruction.limitPrice,
    session: "REGULAR",
    clientOrderId: instruction.clientOrderId,
    expiresAt: instruction.expiresAt,
    exitAuthorizationId: instruction.purpose === "ENTRY" ? null : instruction.linkedEntryId,
  };
}

export function parseInstruction(
  input: unknown,
  now: number,
  secrets: { operator: string | null; gate: string | null },
): { ok: true; value: TradeInstruction } | { ok: false; reason: string } {
  if (!isRecord(input)) return { ok: false, reason: "schema: instruction must be an object" };
  const msg = input;
  if (msg.strategyApproved !== false) return { ok: false, reason: "strategy approval cannot be asserted by research" };
  if (msg.category === "STRATEGY_TRADE") return { ok: false, reason: "STRATEGY_TRADE blocked while strategyApproved=false" };
  if (msg.category !== "CONNECTIVITY_TEST") return { ok: false, reason: "schema: category must be CONNECTIVITY_TEST" };
  if (msg.symbol !== "SPY") return { ok: false, reason: "symbol is not covered by the operator signing module" };
  if (msg.session !== "REGULAR" || msg.timeInForce !== "day") return { ok: false, reason: "limit day regular required" };
  if (msg.purpose !== "ENTRY" && msg.purpose !== "EXIT" && msg.purpose !== "STOP") return { ok: false, reason: "schema: purpose must be ENTRY, EXIT, or STOP" };
  if (msg.side !== "buy" && msg.side !== "sell") return { ok: false, reason: "schema: side invalid" };
  if (msg.orderType !== "limit" && msg.orderType !== "stop" && msg.orderType !== "stop_limit") return { ok: false, reason: "schema: order type invalid" };
  if (typeof msg.decisionId !== "string" || !msg.decisionId) return { ok: false, reason: "schema: decisionId required" };
  if (typeof msg.clientOrderId !== "string" || !ID.test(msg.clientOrderId)) return { ok: false, reason: "schema: clientOrderId invalid" };
  if (typeof msg.nonce !== "string" || !ID.test(msg.nonce)) return { ok: false, reason: "schema: nonce invalid" };
  if (typeof msg.strategyId !== "string" || typeof msg.strategyVersion !== "string") return { ok: false, reason: "schema: strategy identity required" };
  if (typeof msg.authorizationRef !== "string" || !msg.authorizationRef) return { ok: false, reason: "operator authorization reference required" };
  if (typeof msg.expiresAt !== "string" || typeof msg.evidenceTimestamp !== "string") return { ok: false, reason: "schema: timestamps required" };
  if (typeof msg.qty !== "number" || !Number.isFinite(msg.qty) || !(msg.qty > 0)) return { ok: false, reason: "quantity or limit invalid" };
  if (typeof msg.limitPrice !== "number" || !Number.isFinite(msg.limitPrice) || !(msg.limitPrice > 0)) return { ok: false, reason: "quantity or limit invalid" };
  if (typeof msg.sizedNotional !== "number" || !Number.isFinite(msg.sizedNotional)) return { ok: false, reason: "schema: sizedNotional invalid" };
  if (Date.parse(msg.expiresAt) <= now) return { ok: false, reason: "instruction expired" };

  if (msg.purpose === "ENTRY") {
    if (msg.side !== "buy" || msg.orderType !== "limit" || msg.linkedEntryId != null) return { ok: false, reason: "entry must be a limit buy with no linked exit" };
  } else if (msg.purpose === "EXIT") {
    if (msg.side !== "sell" || msg.orderType !== "limit" || typeof msg.linkedEntryId !== "string" || !msg.linkedEntryId) {
      return { ok: false, reason: "exit must be a previously linked limit sell" };
    }
  } else {
    if (msg.side !== "sell" || (msg.orderType !== "stop" && msg.orderType !== "stop_limit")) return { ok: false, reason: "stop must be a sell stop" };
    if (typeof msg.linkedEntryId !== "string" || !msg.linkedEntryId) return { ok: false, reason: "stop requires the authorized entry" };
    if (typeof msg.stopPrice !== "number" || !Number.isFinite(msg.stopPrice) || !(msg.stopPrice > 0)) return { ok: false, reason: "stop price invalid" };
  }

  const gate = msg.gateProof;
  if (!isRecord(gate) || typeof gate.proof !== "string") return { ok: false, reason: "unsigned instruction: missing sigma/sentinel proof" };
  const proof = gate as unknown as GateProof;
  const gateErr = verifyGateProof(
    proof,
    { singleUseId: msg.clientOrderId, symbol: "SPY", side: msg.side, qty: msg.qty, limitPrice: msg.limitPrice },
    now,
    30_000,
    secrets.gate,
  );
  if (gateErr) return { ok: false, reason: gateErr };
  if (proof.sigmaVeto || !proof.sigmaApproved) return { ok: false, reason: "Sigma veto" };
  if (proof.sentinelVeto || !proof.sentinelApproved) return { ok: false, reason: "Sentinel veto" };

  if (msg.purpose === "STOP") {
    const approval = msg.approval as ProtectiveApproval | null;
    if (!approval) return { ok: false, reason: "unsigned instruction" };
    const err = verifyProtectiveApproval(approval, secrets.operator, now);
    if (err) return { ok: false, reason: err.includes("proof") ? `unsigned instruction: ${err}` : err };
    if (approval.clientOrderId !== msg.clientOrderId || approval.linkedEntryId !== msg.linkedEntryId) return { ok: false, reason: "approval identity mismatch" };
    if (approval.qty !== msg.qty || approval.limitPrice !== msg.limitPrice || approval.stopPrice !== msg.stopPrice) return { ok: false, reason: "approval terms mismatch" };
    if (approval.orderType !== msg.orderType || approval.expiresAt !== msg.expiresAt) return { ok: false, reason: "approval terms mismatch" };
    return { ok: true, value: freeze(msg, approval) };
  }

  const approval = msg.approval as OperatorApproval | null;
  if (!approval) return { ok: false, reason: "unsigned instruction" };
  const draft = freeze(msg, approval);
  const err = verifyOperatorApproval(paperTicket(draft), approval, secrets.operator, now);
  if (err) return { ok: false, reason: err.includes("cannot mint") || err.includes("required") ? err : `unsigned instruction: ${err}` };
  return { ok: true, value: draft };
}

function freeze(msg: Record<string, unknown>, approval: OperatorApproval | ProtectiveApproval): TradeInstruction {
  return {
    decisionId: String(msg.decisionId),
    clientOrderId: String(msg.clientOrderId),
    strategyId: String(msg.strategyId),
    strategyVersion: String(msg.strategyVersion),
    strategyApproved: false,
    symbol: "SPY",
    side: msg.side as "buy" | "sell",
    orderType: msg.orderType as TradeInstruction["orderType"],
    purpose: msg.purpose as Purpose,
    qty: msg.qty as number,
    limitPrice: msg.limitPrice as number,
    stopPrice: typeof msg.stopPrice === "number" ? msg.stopPrice : null,
    session: "REGULAR",
    timeInForce: "day",
    expiresAt: String(msg.expiresAt),
    nonce: String(msg.nonce),
    evidenceTimestamp: String(msg.evidenceTimestamp),
    category: "CONNECTIVITY_TEST",
    sizedNotional: msg.sizedNotional as number,
    authorizationRef: String(msg.authorizationRef),
    linkedEntryId: typeof msg.linkedEntryId === "string" ? msg.linkedEntryId : null,
    approval,
    gateProof: msg.gateProof as GateProof,
  };
}
