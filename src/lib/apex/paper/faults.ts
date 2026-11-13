export type Result = "PASS" | "FAIL" | "BLOCKED";

export const FAULTS: { name: string; result: Result; note: string }[] = [
  { name: "lost-ack", result: "PASS", note: "Uncertain submit is not retried." },
  { name: "unknown-order", result: "PASS", note: "State stays unknown until broker confirms." },
  { name: "duplicate-id", result: "PASS", note: "Second submit with the same client id is rejected." },
  { name: "partial-entry", result: "BLOCKED", note: "No live partial-fill fixture was run against a broker." },
  { name: "failed-entry", result: "PASS", note: "Paper auto off returns POLICY_BLOCKED." },
  { name: "failed-exit", result: "BLOCKED", note: "No open position to exit." },
  { name: "partial-exit", result: "BLOCKED", note: "No open position." },
  { name: "restart-open", result: "BLOCKED", note: "No open mock position." },
  { name: "restart-submit", result: "PASS", note: "Pending submit is not resent blindly." },
  { name: "restart-close", result: "BLOCKED", note: "No closing order." },
  { name: "mismatch", result: "PASS", note: "Mismatch fails closed." },
  { name: "stale-data", result: "PASS", note: "Stale data blocks a new entry." },
  { name: "provider-outage", result: "PASS", note: "Model outage returns MODEL_UNAVAILABLE." },
  { name: "emergency-shutdown", result: "PASS", note: "New entries stop. No position to manage." },
];
