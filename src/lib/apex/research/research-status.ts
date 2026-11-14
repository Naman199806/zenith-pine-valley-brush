export type ResearchPhase =
  | "NOT_LIVE_TESTED"
  | "REQUEST_ATTEMPTED"
  | "RESPONSE_RECEIVED"
  | "RESEARCH_COMPLETED"
  | "VALIDATED"
  | "ACCEPTED"
  | "ACCEPTED_WITH_CORRECTION"
  | "REJECTED"
  | "UNAVAILABLE"
  | "PROVIDER_BILLING_BLOCKED";

export interface ResearchStatus {
  id: string;
  phase: ResearchPhase;
  requestAttempted: boolean;
  responseReceived: boolean;
  researchCompleted: boolean;
  validated: boolean;
  accepted: boolean;
  corrected: boolean;
  rejectedClaim: boolean;
  billingBlocked: boolean;
  historical: boolean;
  liveTested: boolean;
  note: string;
}

export const RESEARCH_STATUS: ResearchStatus[] = [
  { id: "vector", phase: "ACCEPTED_WITH_CORRECTION", requestAttempted: true, responseReceived: true, researchCompleted: true, validated: true, accepted: true, corrected: true, rejectedClaim: true, billingBlocked: false, historical: true, liveTested: true, note: "Real XAI research. Finding 2 rejected." },
  { id: "bear", phase: "ACCEPTED", requestAttempted: true, responseReceived: true, researchCompleted: true, validated: true, accepted: true, corrected: false, rejectedClaim: false, billingBlocked: false, historical: true, liveTested: true, note: "Real XAI research accepted." },
  { id: "bull", phase: "PROVIDER_BILLING_BLOCKED", requestAttempted: true, responseReceived: true, researchCompleted: false, validated: false, accepted: false, corrected: false, rejectedClaim: false, billingBlocked: true, historical: false, liveTested: false, note: "One HTTP 402. No research result." },
  ...["scout", "atlas", "oracle", "pulse", "volta", "sigma", "sentinel", "allocator", "pilot", "hermes"].map((id): ResearchStatus => ({
    id,
    phase: "NOT_LIVE_TESTED",
    requestAttempted: false,
    responseReceived: false,
    researchCompleted: false,
    validated: false,
    accepted: false,
    corrected: false,
    rejectedClaim: false,
    billingBlocked: false,
    historical: false,
    liveTested: false,
    note: "MOCK. Not live-tested.",
  })),
];

export function statusOf(id: string): ResearchStatus | undefined {
  return RESEARCH_STATUS.find((row) => row.id === id);
}
