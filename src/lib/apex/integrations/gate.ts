import type { FrameworkHealth, ResearchEvidence, RiskAssessment, TradeProposal } from "./contracts.ts";
import { SCHEMA_VERSION } from "./contracts.ts";

export function proposalDefects(proposal: TradeProposal): string[] {
  const reasons: string[] = [];
  if (proposal.schemaVersion !== SCHEMA_VERSION) reasons.push("Schema version is not supported.");
  if (!proposal.id || !proposal.ts || !proposal.sourceDataTs) reasons.push("Identity or timestamps are missing.");
  if (!proposal.instrument?.symbol) reasons.push("Instrument is missing.");
  if (proposal.executable !== false) reasons.push("A research proposal cannot be executable.");
  if (proposal.validationStatus !== "human-approved" && proposal.validationStatus !== "hypothesis" && proposal.validationStatus !== "rejected") {
    reasons.push("Validation status is not recognized.");
  }
  if (proposal.validationStatus === "hypothesis") reasons.push("A hypothesis is not an approved trade.");
  if (proposal.validationStatus === "rejected") reasons.push("A rejected proposal cannot proceed.");
  if (proposal.evidenceIds.length === 0) reasons.push("Evidence is required.");
  if (!Number.isFinite(proposal.estimatedCostBps) || proposal.estimatedCostBps < 0) reasons.push("Estimated cost is missing.");
  return reasons;
}

export function assessProposal(proposal: TradeProposal): RiskAssessment {
  const reasons = proposalDefects(proposal);
  return {
    schemaVersion: SCHEMA_VERSION,
    proposalId: proposal.id,
    accepted: reasons.length === 0 && proposal.validationStatus === "human-approved",
    reasons,
  };
}

/** Research output is never paper-auto eligible. Human approval still needs the Alpaca launch gate. */
export function paperAutoEligible(proposal: TradeProposal): boolean {
  if (proposal.originFramework === "alpaca-paper") return false;
  if (proposal.validationStatus !== "human-approved") return false;
  return false;
}

export function evidenceDefects(evidence: ResearchEvidence): string[] {
  const reasons: string[] = [];
  if (!evidence.createdAt || !evidence.sourceDataTs) reasons.push("Evidence timestamps are missing.");
  if (evidence.stale) reasons.push("Stale evidence is rejected.");
  if (evidence.references.length === 0) reasons.push("Evidence needs a reference.");
  return reasons;
}

export function outageLeavesRiskIntact(health: FrameworkHealth[], riskPassed: boolean): boolean {
  const blocked = health.filter((row) => row.status === "BLOCKED" || row.status === "NOT_INSTALLED");
  return blocked.length > 0 && riskPassed;
}
