/**
 * Track D fail-closed checks. Does not weaken Sigma or Sentinel.
 */

export interface RiskInput {
  sigmaApproved: boolean;
  sentinelApproved: boolean;
  buyingPower: number;
  proposedNotional: number;
  accountBlocked: boolean;
}

export function riskDecision(input: RiskInput): { allow: false; reason: string } | { allow: true; reason: "mock risk pass" } {
  if (!input.sigmaApproved) return { allow: false, reason: "Sigma veto" };
  if (!input.sentinelApproved) return { allow: false, reason: "Sentinel veto" };
  if (input.accountBlocked) return { allow: false, reason: "account blocked" };
  if (!(input.buyingPower >= input.proposedNotional) || input.proposedNotional > 25) return { allow: false, reason: "sizing rejected" };
  return { allow: true, reason: "mock risk pass" };
}
