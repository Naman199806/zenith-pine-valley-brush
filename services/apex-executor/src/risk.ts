/**
 * Execution risk. Sigma and Sentinel have already had to approve.
 * This layer does not reverse their veto. It applies size, duplicate,
 * position, session, halt, and kill-switch checks before any action.
 */

import { PAPER_RISK } from "../../../src/lib/apex/broker/risk-paper.ts";
import { validateEvidence, type BrokerEvidence } from "../../../src/lib/apex/broker/paper-equity-transport.ts";
import { worstCaseNotional } from "../../../src/lib/apex/live/equity.ts";
import type { TradeInstruction } from "./instruction.ts";

export const MAX_NOTIONAL = 25;

export interface MarketSnapshot {
  evidence: BrokerEvidence;
  openOrderSymbols: string[];
  positionQty: Record<string, number>;
}

export function flatSnapshot(now: number, evidence: Partial<BrokerEvidence> = {}, openOrderSymbols: string[] = []): MarketSnapshot {
  const base: BrokerEvidence = {
    fetchedAt: new Date(now).toISOString(),
    http: { account: 200, clock: 200, positions: 200, openOrders: 200, quote: 200 },
    accountActive: true,
    tradingBlocked: false,
    clockOpen: true,
    positions: [],
    openOrders: openOrderSymbols.length,
    quote: { bid: 749.9, ask: 750, timestamp: new Date(now).toISOString() },
    ...evidence,
  };
  const positionQty: Record<string, number> = {};
  for (const position of base.positions) positionQty[position.symbol] = position.qty;
  return { evidence: base, openOrderSymbols, positionQty };
}

export function minuteEt(now: number): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date(now)).map((part) => [part.type, part.value]));
  return Number(parts.hour) * 60 + Number(parts.minute);
}

export function assessRisk(
  instruction: TradeInstruction,
  snapshot: MarketSnapshot,
  local: { conflict: boolean; ownedQty: number },
  kill: boolean,
  now: number,
): string | null {
  const evidence = snapshot.evidence;
  if (!evidence.accountActive) return "account not eligible";
  if (evidence.tradingBlocked) return "halt: trading blocked";
  const http = evidence.http;
  if (!http || [http.account, http.clock, http.positions, http.openOrders, http.quote].some((status) => status !== 200)) {
    return "incomplete broker response";
  }
  if (local.conflict) return "duplicate order";

  if (instruction.purpose === "ENTRY") {
    if (snapshot.openOrderSymbols.includes(instruction.symbol)) return "duplicate order";
    if (kill) return "kill switch blocks new entries";
    if (minuteEt(now) >= PAPER_RISK.entryCutoffMinute) return "no new entries after the cutoff";
    const notional = worstCaseNotional(instruction.qty, instruction.limitPrice);
    if (notional > MAX_NOTIONAL || instruction.sizedNotional > MAX_NOTIONAL) return "worst-case entry exceeds $25";
    const evidenceErr = validateEvidence(evidence, now);
    if (evidenceErr) return evidenceErr;
    const held = Object.values(snapshot.positionQty).filter((qty) => qty > 0).length;
    if ((snapshot.positionQty[instruction.symbol] ?? 0) > 0) return "per-symbol position limit";
    if (held >= PAPER_RISK.maxPositions) return "position limit";
    return null;
  }

  if (!(local.ownedQty > 0) || instruction.qty > local.ownedQty + 1e-8) return "sell exceeds owned quantity";
  const brokerQty = snapshot.positionQty[instruction.symbol] ?? 0;
  if (!(brokerQty > 0) || instruction.qty > brokerQty + 1e-8) return "broker position does not confirm the journal";
  if (instruction.purpose === "STOP") {
    if (instruction.stopPrice == null) return "stop price invalid";
    if (instruction.orderType === "stop_limit" && instruction.stopPrice > instruction.limitPrice) return "stop price above limit";
  }
  return null;
}
