/**
 * Versioned operator approval shared by scripts/operator-sign-ticket.mjs and Executor.
 * v1 material is exact. The signer refuses an incomplete ticket. Research cannot mint a proof.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export const APPROVAL_VERSION = 1;

export interface CanonicalApproval {
  v: 1;
  source: "OPERATOR_SIGNED";
  clientOrderId: string;
  symbol: "SPY" | "QQQ" | "IWM";
  side: "buy" | "sell";
  orderType: "limit";
  timeInForce: "day";
  qty: number;
  limitPrice: number;
  session: "REGULAR";
  expiresAt: string;
  nonce: string;
  category: "CONNECTIVITY_TEST" | "STRATEGY_TRADE";
  exitAuthorizationId: string | null;
  linkedEntryId: string | null;
}

const SYMBOLS = new Set(["SPY", "QQQ", "IWM"]);

export function canonicalMaterial(a: CanonicalApproval): string {
  return [
    `v=${a.v}`,
    a.source,
    a.symbol,
    a.side,
    a.orderType,
    a.timeInForce,
    String(a.qty),
    String(a.limitPrice),
    a.session,
    a.clientOrderId,
    a.expiresAt,
    a.nonce,
    a.category,
    a.exitAuthorizationId ?? "",
    a.linkedEntryId ?? "",
  ].join("|");
}

export function signApproval(a: CanonicalApproval, secret: string): string {
  return createHmac("sha256", secret).update(canonicalMaterial(a)).digest("hex");
}

export function verifyApproval(a: CanonicalApproval, proof: string | null, secret: string | null, now = Date.now()): string | null {
  if (a.v !== APPROVAL_VERSION || a.source !== "OPERATOR_SIGNED") return "unsupported approval version";
  if (a.category === "STRATEGY_TRADE") return "STRATEGY_TRADE blocked";
  if (!secret) return "operator secret missing; research cannot mint approval";
  if (!proof) return "operator proof required";
  if (Date.parse(a.expiresAt) <= now) return "instruction expired";
  const expected = signApproval(a, secret);
  const left = Buffer.from(proof);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return "operator proof mismatch";
  return null;
}

function incomplete(field: string): { ok: false; reason: string } {
  return { ok: false, reason: `incomplete ticket: ${field}` };
}

/** Refuse rather than fill in missing identity, nonce, category, or authorization fields. */
export function proposedTicket(input: unknown): { ok: true; approval: CanonicalApproval } | { ok: false; reason: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) return incomplete("ticket");
  const row = input as Record<string, unknown>;
  if (row.verdict !== "READY_FOR_OPERATOR_APPROVAL") return { ok: false, reason: "ticket is not ready for approval" };
  if (row.v !== APPROVAL_VERSION) return incomplete("v");
  if (typeof row.clientOrderId !== "string" || !row.clientOrderId) return incomplete("clientOrderId");
  if (typeof row.nonce !== "string" || !row.nonce) return incomplete("nonce");
  if (typeof row.symbol !== "string" || !SYMBOLS.has(row.symbol)) return incomplete("symbol");
  if (row.side !== "buy" && row.side !== "sell") return incomplete("side");
  if (row.orderType !== "limit") return incomplete("orderType");
  if (row.timeInForce !== "day") return incomplete("timeInForce");
  if (row.session !== "REGULAR") return incomplete("session");
  if (row.category !== "CONNECTIVITY_TEST") return incomplete("category");
  if (typeof row.qty !== "number" || !Number.isFinite(row.qty) || !(row.qty > 0)) return incomplete("qty");
  if (typeof row.limitPrice !== "number" || !Number.isFinite(row.limitPrice) || !(row.limitPrice > 0)) return incomplete("limitPrice");
  if (typeof row.expiresAt !== "string" || !row.expiresAt || !Number.isFinite(Date.parse(row.expiresAt))) return incomplete("expiresAt");
  if (!("exitAuthorizationId" in row)) return incomplete("exitAuthorizationId");
  if (!("linkedEntryId" in row)) return incomplete("linkedEntryId");
  if (row.exitAuthorizationId != null && typeof row.exitAuthorizationId !== "string") return incomplete("exitAuthorizationId");
  if (row.linkedEntryId != null && typeof row.linkedEntryId !== "string") return incomplete("linkedEntryId");
  if (row.side === "sell" && (typeof row.exitAuthorizationId !== "string" || typeof row.linkedEntryId !== "string")) {
    return incomplete("sell authorization");
  }
  return {
    ok: true,
    approval: {
      v: 1,
      source: "OPERATOR_SIGNED",
      clientOrderId: row.clientOrderId,
      symbol: row.symbol as CanonicalApproval["symbol"],
      side: row.side,
      orderType: "limit",
      timeInForce: "day",
      qty: row.qty,
      limitPrice: row.limitPrice,
      session: "REGULAR",
      expiresAt: row.expiresAt,
      nonce: row.nonce,
      category: "CONNECTIVITY_TEST",
      exitAuthorizationId: row.exitAuthorizationId == null ? null : row.exitAuthorizationId,
      linkedEntryId: row.linkedEntryId == null ? null : row.linkedEntryId,
    },
  };
}
