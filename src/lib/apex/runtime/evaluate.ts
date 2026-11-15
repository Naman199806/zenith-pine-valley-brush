import { runMissionCycle } from "../research/mission-cycle.ts";
import { planPaperOrder } from "../broker/paper-pipeline.ts";
import { completedBars, type Bar } from "../research/fmz-bb-rsi.ts";

export function evaluateRuntime(input: { bars: Bar[]; nowMs?: number; price?: number; cash?: number; ownedQty?: number; authorizationExpiresAt?: string | null }) {
  const nowMs = input.nowMs ?? Date.now();
  const bars = completedBars(input.bars, nowMs);
  const cycle = runMissionCycle({ bars, nowMs, strategyApproved: false, pilotExpired: true, billingLocked: true, brokerConnected: true });
  const plan = planPaperOrder({
    signal: cycle.finalDecision === "BUY" ? "BUY" : cycle.finalDecision === "EXIT" ? "EXIT" : "WAIT",
    price: input.price ?? bars.at(-1)?.c ?? 0,
    cash: input.cash ?? 0,
    maxNotional: 25,
    strategyApproved: false,
    riskOk: cycle.sentinel === "PASS",
    billingLocked: true,
    authorizationExpiresAt: input.authorizationExpiresAt ?? null,
    nowMs,
    ownedQty: input.ownedQty ?? 0,
    endpoint: "https://paper-api.alpaca.markets/v2/orders",
  });
  return { cycle, plan, brokerWrites: 0 as const };
}
