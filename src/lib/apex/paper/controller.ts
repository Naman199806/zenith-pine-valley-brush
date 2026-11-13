export const PAPER_STATES = [
  "PROPOSED",
  "VALIDATING",
  "APPROVED_BY_POLICY",
  "SUBMITTING",
  "ACKNOWLEDGED",
  "PARTIALLY_FILLED",
  "FILLED",
  "CLOSING",
  "CLOSED",
  "ERROR",
] as const;

export type PaperState = (typeof PAPER_STATES)[number];

export function nextState(state: PaperState, paperAuto: boolean): PaperState | "POLICY_BLOCKED" {
  if (!paperAuto && state === "PROPOSED") return "POLICY_BLOCKED";
  if (state === "PROPOSED") return "VALIDATING";
  if (state === "VALIDATING") return "APPROVED_BY_POLICY";
  return state;
}
