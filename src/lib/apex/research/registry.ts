export const STATES = ["RESEARCH", "REJECTED", "VALIDATION", "PAPER_EXPERIMENT", "LIVE_APPROVED"] as const;
export type ResearchState = (typeof STATES)[number];

export function canExperiment(state: ResearchState, approvedByOperator: boolean, paperAuto: boolean): boolean {
  return state === "PAPER_EXPERIMENT" && approvedByOperator && paperAuto;
}
