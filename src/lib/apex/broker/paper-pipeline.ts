import { assertOrderEndpoint } from "./live-guard.ts";

export interface PipelineInput {
  signal: "BUY" | "EXIT" | "WAIT";
  price: number;
  cash: number;
  maxNotional: number;
  strategyApproved: boolean;
  riskOk: boolean;
  billingLocked: boolean;
  authorizationExpiresAt: string | null;
  nowMs: number;
  ownedQty: number;
  endpoint: string;
}

export interface PipelineResult {
  action: "NO_TRADE" | "DRY_RUN_BUY" | "DRY_RUN_EXIT";
  qty: number;
  reason: string;
  brokerWrites: 0;
}

export function planPaperOrder(input: PipelineInput): PipelineResult {
  assertOrderEndpoint(input.endpoint);
  const expired = !input.authorizationExpiresAt || Date.parse(input.authorizationExpiresAt) <= input.nowMs;
  if (input.ownedQty > 0 && input.signal === "EXIT") {
    return { action: "DRY_RUN_EXIT", qty: input.ownedQty, reason: "risk-reducing exit planned; billing lock does not block it", brokerWrites: 0 };
  }
  if (!input.riskOk) return { action: "NO_TRADE", qty: 0, reason: "fresh risk verdict failed", brokerWrites: 0 };
  if (!input.strategyApproved) return { action: "NO_TRADE", qty: 0, reason: "strategyApproved=false", brokerWrites: 0 };
  if (expired) return { action: "NO_TRADE", qty: 0, reason: "authorization expired", brokerWrites: 0 };
  if (input.signal !== "BUY") return { action: "NO_TRADE", qty: 0, reason: "no buy signal", brokerWrites: 0 };
  const budget = Math.min(input.maxNotional, input.cash);
  const qty = Math.floor((budget / input.price) * 1e8) / 1e8;
  return { action: "DRY_RUN_BUY", qty, reason: "stubbed broker only", brokerWrites: 0 };
}
