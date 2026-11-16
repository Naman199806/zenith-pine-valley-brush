/**
 * Execution-mode gate.
 * These defaults are frozen. The executor cannot mint the operator grant
 * that would be required to go further, and this sprint still refuses
 * every Alpaca POST. Passing a paper exercise never flips LIVE.
 */

import { promoteLaunch } from "../../../src/lib/apex/broker/launch.ts";
import { liveReadiness } from "../../../src/lib/apex/broker/live-guard.ts";
import { verifyOperatorPostEnable, type PostEnableGrant } from "../../../src/lib/apex/broker/paper-equity-transport.ts";

export const MODE_GATE = Object.freeze({
  mode: "PAPER_READ_ONLY",
  paperPost: "DISABLED",
  livePost: "DISABLED",
  autonomousStrategyTrading: "DISABLED",
  strategyApproved: false,
});

export type TransportKind = "mock" | "alpaca-paper" | "alpaca-live";

export function liveSelectionBlocked(): { blocked: true; reason: string } {
  const launched = promoteLaunch("MONITORING", "LIVE", {
    safetyPassed: true,
    paperAccountConfirmed: true,
    reconciliationClean: true,
    operatorApprovedAuto: true,
  });
  const readiness = liveReadiness();
  return {
    blocked: true,
    reason: launched.ok ? "LIVE selection must stay blocked" : `${launched.reasons[0] ?? "LIVE blocked"} ${readiness.microLive}`,
  };
}

export function postDecision(input: {
  venue: "PAPER" | "LIVE";
  transportKind: TransportKind;
  grant: PostEnableGrant | null;
  operatorSecret: string | null;
  now: number;
  paperTestsPassed: boolean;
}): { allowed: boolean; reason: string } {
  if (MODE_GATE.strategyApproved !== false) return { allowed: false, reason: "strategyApproved must stay false" };
  if (MODE_GATE.autonomousStrategyTrading !== "DISABLED") return { allowed: false, reason: "autonomous strategy trading DISABLED" };
  if (MODE_GATE.mode !== "PAPER_READ_ONLY" || MODE_GATE.paperPost !== "DISABLED" || MODE_GATE.livePost !== "DISABLED") {
    return { allowed: false, reason: "mode gate defaults were mutated" };
  }
  if (input.venue === "LIVE" || input.transportKind === "alpaca-live") {
    void input.paperTestsPassed;
    void input.grant;
    return { allowed: false, reason: "LIVE POST DISABLED" };
  }
  if (input.transportKind !== "mock") return { allowed: false, reason: "PAPER POST DISABLED" };
  if (!input.grant || input.grant.enable !== "PAPER_POST") return { allowed: false, reason: "PAPER POST DISABLED" };
  const grantErr = verifyOperatorPostEnable(input.grant, input.operatorSecret, input.now);
  if (grantErr) return { allowed: false, reason: `PAPER POST DISABLED: ${grantErr}` };
  void input.paperTestsPassed;
  return { allowed: true, reason: "mock submission allowed by external operator authorization" };
}
