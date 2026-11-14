import { readFileSync } from "node:fs";
import { decide, type Decision } from "./decide.ts";
import { loadLock, paidRequestsBlocked } from "./billing-lock.ts";

export interface EvidenceItem {
  agent: string;
  runId: string;
  providerRequestId: string | null;
  provenance: "XAI_API" | "MOCK" | "SYNTHETIC" | "MANUAL_COPY";
  status: "ACCEPTED" | "REJECTED" | "UNAVAILABLE" | "PROVIDER_BILLING_BLOCKED";
  asOfUtc: string | null;
  historical: boolean;
  current: boolean;
  text: string;
  reason?: string;
}

export interface Aggregate {
  asOfUtc: string;
  accepted: EvidenceItem[];
  rejected: EvidenceItem[];
  unavailable: EvidenceItem[];
  decision: Decision;
  billingLocked: boolean;
  paidCalls: 0;
  brokerWrites: 0;
}

const REJECTED_VECTOR = "Prior three completed bars show successive lower closes";

export function loadReplay(root: string, now = "2026-11-14T00:10:00Z"): Aggregate {
  const vector = JSON.parse(readFileSync(`${root}/research/lab/vector-xai-validated.json`, "utf8"));
  const bear = JSON.parse(readFileSync(`${root}/research/lab/bear-xai-validated.json`, "utf8"));
  const recon = JSON.parse(readFileSync(`${root}/research/lab/vector-reconciliation.json`, "utf8"));
  const bull = JSON.parse(readFileSync(`${root}/research/lab/bull-xai-rejection.json`, "utf8"));
  const lockPath = `${root}/research/lab/xai-billing-lock.json`;
  const historical = (asOf: string) => asOf < now.slice(0, 10);

  const accepted: EvidenceItem[] = [];
  const rejected: EvidenceItem[] = [];
  const unavailable: EvidenceItem[] = [];

  for (const finding of vector.parsed.findings as string[]) {
    const item: EvidenceItem = {
      agent: "vector",
      runId: vector.parsed.run_id,
      providerRequestId: vector.providerRequestId,
      provenance: "XAI_API",
      status: finding.startsWith(REJECTED_VECTOR) || recon.overall.findingTwoRejected && finding.includes("successive lower closes") ? "REJECTED" : "ACCEPTED",
      asOfUtc: vector.parsed.as_of_utc,
      historical: historical(vector.parsed.as_of_utc),
      current: false,
      text: finding,
      reason: finding.includes("successive lower closes") ? recon.narrativeConsistency.contradiction : undefined,
    };
    (item.status === "REJECTED" ? rejected : accepted).push(item);
  }

  for (const finding of bear.parsed.findings as string[]) {
    accepted.push({
      agent: "bear",
      runId: bear.parsed.run_id,
      providerRequestId: bear.providerRequestId,
      provenance: "XAI_API",
      status: "ACCEPTED",
      asOfUtc: bear.parsed.as_of_utc,
      historical: historical(bear.parsed.as_of_utc),
      current: false,
      text: finding,
    });
  }

  unavailable.push({
    agent: "bull",
    runId: bull.run_id,
    providerRequestId: null,
    provenance: "XAI_API",
    status: "PROVIDER_BILLING_BLOCKED",
    asOfUtc: null,
    historical: false,
    current: false,
    text: "No research result.",
    reason: bull.providerCode,
  });

  const decision = decide({
    instrument: "BTC/USD",
    quantOk: true,
    riskOk: true,
    strategyApproved: false,
    agent: { stance: "SUPPORT", evidenceId: "historical-xai", asOf: vector.parsed.as_of_utc },
  });

  return {
    asOfUtc: now,
    accepted,
    rejected,
    unavailable,
    decision,
    billingLocked: paidRequestsBlocked(lockPath),
    paidCalls: 0,
    brokerWrites: 0,
  };
}
