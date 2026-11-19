/**
 * Supervised PAPER orders whose signatures bind the broker body.
 * MARKET_NOTIONAL and MARKET_QTY are additive. The limit-ticket material
 * in approval.ts is not modified, and a limit ticket is never rewritten
 * into a market order.
 *
 * Alpaca create order: https://docs.alpaca.markets/us/reference/postorder
 * The wire field is type=market. market_notional sends notional and omits qty.
 * market_qty sends qty and omits notional. extended_hours and time_in_force
 * are the signed values, copied unchanged.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { clientOrderIdProblem, MAX_NOTIONAL_USD, MIN_NOTIONAL_USD } from "./order-shape.ts";

export const SUPERVISED_ORDER_VERSION = 1;

export interface SupervisedGateProof {
  v: 1;
  symbol: "SPY";
  side: "buy" | "sell";
  orderType: "market_notional" | "market_qty";
  timeInForce: "day";
  extendedHours: false;
  notional: string | null;
  qty: string | null;
  clientOrderId: string;
  expiresAt: string;
  computedAt: string;
  sigmaApproved: boolean;
  sentinelApproved: boolean;
  sigmaVeto: boolean;
  sentinelVeto: boolean;
  proof: string;
}

interface SupervisedCommon {
  v: 1;
  source: "OPERATOR_SIGNED";
  category: "SUPERVISED_PAPER_TEST";
  symbol: "SPY";
  timeInForce: "day";
  extendedHours: false;
  clientOrderId: string;
  expiresAt: string;
  nonce: string;
  session: "REGULAR";
  decisionId: string;
  strategyId: string;
  strategyVersion: string;
  strategyApproved: false;
  operatorProof: string | null;
  gateProof: SupervisedGateProof | null;
}

export interface SupervisedNotionalBuy extends SupervisedCommon {
  side: "buy";
  orderType: "market_notional";
  notional: string;
  exitAuthorizationId: null;
  linkedEntryId: null;
}

export interface SupervisedQtySell extends SupervisedCommon {
  side: "sell";
  orderType: "market_qty";
  qty: string;
  exitAuthorizationId: string;
  linkedEntryId: string;
}

export type SupervisedOrder = SupervisedNotionalBuy | SupervisedQtySell;

export interface SignedBrokerBody {
  symbol: "SPY";
  side: "buy" | "sell";
  type: "market";
  time_in_force: "day";
  extended_hours: false;
  client_order_id: string;
  notional?: string;
  qty?: string;
}

function hmac(secret: string, material: string): string {
  return createHmac("sha256", secret).update(material).digest("hex");
}

function same(proof: string, expected: string): boolean {
  const left = Buffer.from(proof);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Operator material. Nonce is included so a restart cannot replay it. Limit material is a different function. */
export function supervisedOrderMaterial(order: SupervisedOrder): string {
  return [
    `v=${order.v}`,
    "SUPERVISED_ORDER",
    order.source,
    order.category,
    order.symbol,
    order.side,
    order.orderType,
    order.timeInForce,
    order.extendedHours ? "true" : "false",
    order.orderType === "market_notional" ? order.notional : "",
    order.orderType === "market_qty" ? order.qty : "",
    order.clientOrderId,
    order.expiresAt,
    order.nonce,
    order.session,
    order.exitAuthorizationId ?? "",
    order.linkedEntryId ?? "",
    String(order.strategyApproved),
  ].join("|");
}

export function supervisedGateMaterial(proof: Omit<SupervisedGateProof, "proof">): string {
  return [
    `v=${proof.v}`,
    "SUPERVISED_GATE",
    proof.symbol,
    proof.side,
    proof.orderType,
    proof.timeInForce,
    proof.extendedHours ? "true" : "false",
    proof.notional ?? "",
    proof.qty ?? "",
    proof.clientOrderId,
    proof.expiresAt,
    proof.computedAt,
    String(proof.sigmaApproved),
    String(proof.sentinelApproved),
    String(proof.sigmaVeto),
    String(proof.sentinelVeto),
  ].join("|");
}

export function signSupervisedOrder(order: SupervisedOrder, secret: string): string {
  return hmac(secret, supervisedOrderMaterial(order));
}

export function signSupervisedGate(order: SupervisedOrder, secret: string, now: number, flags?: Partial<Pick<SupervisedGateProof, "sigmaApproved" | "sentinelApproved" | "sigmaVeto" | "sentinelVeto">>): SupervisedGateProof {
  const base: Omit<SupervisedGateProof, "proof"> = {
    v: 1,
    symbol: order.symbol,
    side: order.side,
    orderType: order.orderType,
    timeInForce: order.timeInForce,
    extendedHours: order.extendedHours,
    notional: order.orderType === "market_notional" ? order.notional : null,
    qty: order.orderType === "market_qty" ? order.qty : null,
    clientOrderId: order.clientOrderId,
    expiresAt: order.expiresAt,
    computedAt: new Date(now).toISOString(),
    sigmaApproved: flags?.sigmaApproved !== false,
    sentinelApproved: flags?.sentinelApproved !== false,
    sigmaVeto: flags?.sigmaVeto === true,
    sentinelVeto: flags?.sentinelVeto === true,
  };
  if (base.sigmaVeto) base.sigmaApproved = false;
  if (base.sentinelVeto) base.sentinelApproved = false;
  return { ...base, proof: hmac(secret, supervisedGateMaterial(base)) };
}

export function notionalProblem(notional: string): string | null {
  if (typeof notional !== "string" || !/^\d+\.\d{2}$/.test(notional)) return "notional must be the exact signed cents string";
  const value = Number(notional);
  if (!Number.isFinite(value) || value < MIN_NOTIONAL_USD || value > MAX_NOTIONAL_USD) return "notional exceeds $25";
  if (value < MIN_NOTIONAL_USD) return "notional must be between $1 and $25 in cents";
  return null;
}

export function qtyStringProblem(qty: string): string | null {
  if (typeof qty !== "string" || !/^(?:0|[1-9]\d*)(?:\.\d{1,9})?$/.test(qty)) return "qty must be the exact signed quantity string";
  const value = Number(qty);
  if (!Number.isFinite(value) || !(value > 0)) return "sell quantity invalid";
  return null;
}

export function verifySupervisedOrder(order: SupervisedOrder, secrets: { operator: string | null; gate: string | null }, now: number): string | null {
  if (order.v !== SUPERVISED_ORDER_VERSION || order.source !== "OPERATOR_SIGNED") return "unsupported approval version";
  if (order.strategyApproved !== false) return "strategy approval cannot be asserted by research";
  if (order.category !== "SUPERVISED_PAPER_TEST") return "supervised paper test category required";
  if (order.symbol !== "SPY") return "supervised path is SPY only";
  if (order.timeInForce !== "day") return "time_in_force must be day";
  if (order.extendedHours !== false) return "extended_hours must be false";
  if (order.session !== "REGULAR") return "regular session required";
  const id = clientOrderIdProblem(order.clientOrderId);
  if (id) return id;
  if (Date.parse(order.expiresAt) <= now) return "instruction expired";
  if (order.orderType === "market_notional") {
    if (order.side !== "buy") return "market_notional is buy only";
    const notional = notionalProblem(order.notional);
    if (notional) return notional;
    if (order.exitAuthorizationId !== null || order.linkedEntryId !== null) return "buy linkage invalid";
  } else {
    if (order.side !== "sell") return "market_qty supervised order is a sell";
    const qty = qtyStringProblem(order.qty);
    if (qty) return qty;
    if (!order.exitAuthorizationId || !order.linkedEntryId) return "exit not linked to entry";
  }
  if (!secrets.operator) return "operator secret missing; research cannot mint approval";
  if (!order.operatorProof) return "operator proof required";
  if (!same(order.operatorProof, signSupervisedOrder(order, secrets.operator))) return "operator proof mismatch";
  if (!secrets.gate) return "gate issuer secret missing; fail closed";
  const gate = order.gateProof;
  if (!gate) return "missing ticket-bound gate proof";
  if (!same(gate.proof, hmac(secrets.gate, supervisedGateMaterial(gate)))) return "gate proof was not issued by Sigma/Sentinel";
  if (gate.symbol !== order.symbol || gate.side !== order.side || gate.orderType !== order.orderType) return "gate proof not bound to the order";
  if (gate.timeInForce !== order.timeInForce || gate.extendedHours !== order.extendedHours) return "gate proof not bound to the order";
  if ((gate.notional ?? "") !== (order.orderType === "market_notional" ? order.notional : "")) return "gate proof not bound to the order";
  if ((gate.qty ?? "") !== (order.orderType === "market_qty" ? order.qty : "")) return "gate proof not bound to the order";
  if (gate.clientOrderId !== order.clientOrderId || gate.expiresAt !== order.expiresAt) return "gate proof not bound to the order";
  const age = now - Date.parse(gate.computedAt);
  if (!Number.isFinite(age) || age < 0 || age > 30_000) return "gate proof stale or future";
  if (gate.sigmaVeto || !gate.sigmaApproved) return "Sigma veto";
  if (gate.sentinelVeto || !gate.sentinelApproved) return "Sentinel veto";
  return null;
}

/** The only legal Alpaca body for this signed order. Fields are copied, never reformatted. */
export function exactBrokerBody(order: SupervisedOrder): SignedBrokerBody {
  const common = {
    symbol: order.symbol,
    side: order.side,
    type: "market" as const,
    time_in_force: order.timeInForce,
    extended_hours: order.extendedHours,
    client_order_id: order.clientOrderId,
  };
  if (order.orderType === "market_notional") return { ...common, notional: order.notional };
  return { ...common, qty: order.qty };
}

export function brokerBodyMismatch(order: SupervisedOrder, body: object): string | null {
  const expected = exactBrokerBody(order) as unknown as Record<string, string | boolean>;
  const actual = body as Record<string, unknown>;
  const expectedKeys = Object.keys(expected).sort();
  const actualKeys = Object.keys(actual).sort();
  if (expectedKeys.join(",") !== actualKeys.join(",")) return "broker body does not match the signed order";
  for (const key of expectedKeys) {
    if (actual[key] !== expected[key]) return `broker body ${key} does not match the signed order`;
  }
  if ("qty" in actual && order.orderType === "market_notional") return "broker body does not match the signed order";
  if ("notional" in actual && order.orderType === "market_qty") return "broker body does not match the signed order";
  return null;
}

export function limitConversionRefusal(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const row = value as { orderType?: unknown };
  if (row.orderType === "limit") return "limit order cannot be converted";
  return null;
}
