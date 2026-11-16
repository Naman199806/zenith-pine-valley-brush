/**
 * Versioned operator approval contract shared by the signer and Executor.
 * v1 material is exact. Research cannot mint a valid proof.
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
