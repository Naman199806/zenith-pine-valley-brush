/**
 * Six-stage architecture readiness matrix.
 * Market Data → Scanner → 13 Agents → Decision Gates → Execution → Hermes
 * Sigma and Sentinel independently veto. No fake inference. No strategy approval.
 */

import { agentRoleStatus } from "./connectivity.ts";

export interface StageStatus {
  stage: string;
  ready: boolean;
  evidence: string;
  blockers: string[];
}

export function architectureReadiness(): StageStatus[] {
  const roles = agentRoleStatus();
  const blocked = Object.entries(roles).filter(([, v]) => v.status === "BLOCKED").map(([k]) => k);
  const unavailable = Object.entries(roles).filter(([, v]) => v.status === "UNAVAILABLE").map(([k]) => k);
  return [
    {
      stage: "1. Market Data",
      ready: true,
      evidence: "Coinbase BTC/USD historical, Yahoo ETF/stock, Alpaca PAPER state, local research artifacts",
      blockers: [],
    },
    {
      stage: "2. Scanner",
      ready: true,
      evidence: "Scout scans local datasets; no live autonomous scan",
      blockers: [],
    },
    {
      stage: "3. 13 Agents",
      ready: false,
      evidence: `Roles: ${Object.keys(roles).length}. Real data: Scout/Vector/Oracle/Sigma/Sentinel/Allocator/Hermes (deterministic or local). Blocked: ${blocked.join(", ")}. Unavailable: ${unavailable.join(", ")}.`,
      blockers: ["Bull and Bear blocked by billing lock; no fake inference", "Pulse and Volta unavailable", "Pilot blocked"],
    },
    {
      stage: "4. Decision Gates",
      ready: true,
      evidence: "Sigma validates data integrity and test constraints. Sentinel enforces exposure and risk vetoes. Both independent. strategyApproved remains false.",
      blockers: ["No validated strategy; NO_TRADE remains native decision"],
    },
    {
      stage: "5. Execution",
      ready: false,
      evidence: "PAPER adapters and journals exist. Isolated LIVE transport is hard-disabled. CONNECTIVITY_TEST only.",
      blockers: ["LIVE order transport disabled by default", "No separate real-money order authorization", "No live quote verification"],
    },
    {
      stage: "6. Hermes",
      ready: true,
      evidence: "Durable intent journal, single-use consumption, status reconciliation, crash replay",
      blockers: [],
    },
  ];
}

export function sigmaVeto(reason: string): { veto: true; gate: "Sigma"; reason: string } {
  return { veto: true, gate: "Sigma", reason };
}

export function sentinelVeto(reason: string): { veto: true; gate: "Sentinel"; reason: string } {
  return { veto: true, gate: "Sentinel", reason };
}
