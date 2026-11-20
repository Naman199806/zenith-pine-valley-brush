/**
 * Every supervised submit and exit passes through this list.
 * A dev flag, a paper-post env var, or a passing test does not skip any line.
 * STRATEGY_TRADE stays blocked. strategyApproved must stay false.
 */

import { tradingOriginGuard } from "../../../src/lib/apex/broker/allowlist.ts";
import { verifyInstruction, type TradeInstruction } from "./instruction.ts";
import type { LifecycleRecord } from "./lifecycle.ts";
import { clientOrderIdProblem, formatNotional, MAX_NOTIONAL_USD, MIN_NOTIONAL_USD } from "./order-shape.ts";
import type { OrderState } from "./order-machine.ts";

export function paperPostEnvOn(env: NodeJS.ProcessEnv): boolean {
  return env.PAPER_POST_ENABLED === "true";
}

export function devSubmitFlag(env: NodeJS.ProcessEnv): boolean {
  return env.APEX_EXECUTOR_DEV_SUBMIT === "true" || env.APEX_EXECUTOR_DEV_SUBMIT === "1" || env.APEX_EXECUTOR_ALLOW_SUBMIT === "1";
}

export interface SubmitFacts {
  env: NodeJS.ProcessEnv;
  now: number;
  writerInjected: boolean;
  lockHeld: boolean;
  kill: boolean;
  recoveryPending: boolean;
  reconciliationOk: boolean;
  fresh: boolean;
  marketPresent: boolean;
  marketOpen: boolean;
  clockHttpOk: boolean;
  unknownOrders: number;
  inFlight: number;
  outstandingCap: number;
  budgetOk: boolean;
  mode: "PAPER" | "LIVE";
  maxQty: number | null;
  instruction: TradeInstruction;
  record: LifecycleRecord | null;
  secrets: { operator: string | null; gate: string | null };
  brokerOwnedQty: number | null;
  pendingSellQty: number;
  heldSpy: boolean;
}

function phaseOf(record: LifecycleRecord): OrderState {
  if (record.orderState) return record.orderState;
  if (record.submitted || record.state === "SUBMISSION_ATTEMPTED") return "submitted";
  return "intent";
}

export function submitRefusal(facts: SubmitFacts): string | null {
  const instruction = facts.instruction;
  if (!facts.writerInjected) return "REAL_BROKER_WRITE_DISABLED";
  if (devSubmitFlag(facts.env) && !paperPostEnvOn(facts.env)) return "dev flag cannot authorize submission";
  if (!paperPostEnvOn(facts.env)) return "PAPER POST DISABLED";
  if (facts.env.LIVE_POST_ENABLED === "true" || facts.env.APEX_EXECUTOR_ENABLE_LIVE === "I_ENABLE_LIVE") return "LIVE POST DISABLED";
  const origin = tradingOriginGuard(facts.env.APCA_API_BASE_URL);
  if (origin.blockOrders) return "LIVE URL refused";
  if (facts.mode !== "PAPER") return "LIVE submission disabled";
  if (!facts.lockHeld) return "writer lock not held";
  if (facts.recoveryPending) return "in-flight orders unresolved";
  if (instruction.strategyApproved !== false) return "strategy approval cannot be asserted by research";
  if (instruction.category === "STRATEGY_TRADE") return "STRATEGY_TRADE blocked while strategyApproved=false";
  if (instruction.category !== "SUPERVISED_PAPER_TEST") return "supervised paper test category required";
  if (instruction.symbol !== "SPY") return "supervised path is SPY only";
  const id = clientOrderIdProblem(instruction.clientOrderId);
  if (id) return id;
  const signed = verifyInstruction(instruction, facts.secrets, facts.now);
  if (signed) return signed;
  if (!facts.record) return "durable intent missing";
  if (facts.record.confirmedAbsent) return "resubmit requires a new approval";
  if (facts.record.clientOrderId !== instruction.clientOrderId || facts.record.symbol !== instruction.symbol || facts.record.side !== instruction.side) {
    return "instruction does not match the durable intent";
  }
  if (Math.abs(facts.record.qty - instruction.qty) > 1e-12) return "instruction does not match the durable intent";
  if (phaseOf(facts.record) !== "intent") return "duplicate submit";
  if (facts.kill && instruction.side === "buy") return "kill switch blocks new entries";
  if (!facts.marketPresent) return "broker evidence missing";
  if (!facts.fresh) return "stale broker evidence";
  if (!facts.reconciliationOk) return "broker reconciliation failed";
  if (!facts.clockHttpOk || !facts.marketOpen) return "market closed";
  if (facts.maxQty == null || !Number.isFinite(facts.maxQty) || !(facts.maxQty > 0)) return "max qty unavailable";
  if (!Number.isFinite(instruction.qty) || instruction.qty > facts.maxQty) return "quantity exceeds max";
  if (instruction.side === "buy") {
    if (facts.heldSpy) return "per-symbol position limit";
    if (instruction.sizedNotional > MAX_NOTIONAL_USD || instruction.qty * instruction.limitPrice > MAX_NOTIONAL_USD) return "notional exceeds $25";
    if (formatNotional(instruction.sizedNotional) == null || instruction.sizedNotional < MIN_NOTIONAL_USD) return "notional must be between $1 and $25 in cents";
  }
  if (facts.unknownOrders > 0) return "UNKNOWN orders block new submits";
  if (facts.inFlight >= facts.outstandingCap) return "outstanding order cap";
  if (instruction.side === "sell") {
    if (facts.brokerOwnedQty == null || !Number.isFinite(facts.brokerOwnedQty)) return "owned quantity unresolved";
    if (!(facts.brokerOwnedQty > 0)) return "sell exceeds broker-owned quantity";
    const room = facts.brokerOwnedQty - facts.pendingSellQty;
    if (instruction.qty > room + 1e-12) return "sell exceeds broker-owned quantity";
  }
  if (!facts.budgetOk) return "request budget exceeded";
  return null;
}
