import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runPaperSafety } from "../broker/safety.ts";
import type { FrameworkHealth, FrameworkId, IntegrationEvent, TradeProposal } from "./contracts.ts";
import { SCHEMA_VERSION } from "./contracts.ts";
import { evidenceRoot } from "./evidence-root.ts";
import { assessProposal, evidenceDefects, paperAutoEligible } from "./gate.ts";

const ROOT = process.cwd();
const REPORT = join(ROOT, "research", "integration-report.json");
const disabled = new Set<FrameworkId>();

const EVIDENCE: Partial<Record<FrameworkId, string>> = {
  lean: join(ROOT, ".runtimes/lean-run/apex-lean-summary.json"),
  tradingagents: join(ROOT, ".runtimes/tradingagents-run/invoke.json"),
  hermes: join(ROOT, ".runtimes/hermes-run/experiment.json"),
  freqtrade: join(ROOT, ".runtimes/freqtrade-run/backtest.log"),
  "day-trader-skill": join(ROOT, ".runtimes/day-trader-run/workflow.json"),
};

export function setAdapterEnabled(id: FrameworkId, enabled: boolean): void {
  if (enabled) disabled.delete(id);
  else disabled.add(id);
}

function absent(id: FrameworkId, name: string, license: string, reason: string): FrameworkHealth {
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    name,
    version: null,
    license,
    status: "NOT_INSTALLED",
    process: "absent",
    adapter: "present",
    lastConnection: null,
    lastTest: null,
    activeCapability: "None",
    capabilities: [],
    permissions: "No broker permission.",
    errors: [reason],
    runtime: "Unknown until integrations:verify runs",
    health: "No report",
    boundary: "Research output cannot become an order.",
    enabled: !disabled.has(id),
  };
}

function guard(row: FrameworkHealth): FrameworkHealth {
  if (disabled.has(row.id)) {
    return { ...row, enabled: false, status: "BLOCKED", process: "blocked", errors: ["Adapter disabled. It was not invoked."] };
  }
  if (row.status === "ACTIVE") {
    return { ...row, status: "DEGRADED", errors: [...row.errors, "ACTIVE is not granted. No recurring workflow is monitored."] };
  }
  const evidence = EVIDENCE[row.id];
  if ((row.status === "TESTED" || row.status === "DEGRADED") && evidence && !existsSync(evidence)) {
    return { ...row, status: "DEGRADED", errors: [...row.errors, "Evidence file is missing."] };
  }
  return { ...row, enabled: !disabled.has(row.id) };
}

export function integrationHealth(): FrameworkHealth[] {
  if (!existsSync(REPORT)) {
    return [
      absent("lean", "QuantConnect LEAN", "Apache-2.0", "Run npm run integrations:verify."),
      absent("tradingagents", "TradingAgents", "Apache-2.0", "Run npm run integrations:verify."),
      absent("hermes", "Hermes Agent", "MIT", "Run npm run integrations:verify."),
      absent("freqtrade", "Freqtrade", "GPL-3.0-only", "Run npm run integrations:verify."),
      absent("backtrader", "Backtrader", "GPL-3.0-or-later", "Run npm run integrations:verify."),
      absent("day-trader-skill", "Day Trader Skill", "MIT", "Run npm run integrations:verify."),
    ];
  }
  const report = JSON.parse(readFileSync(REPORT, "utf8")) as { frameworks?: FrameworkHealth[] };
  return (report.frameworks ?? []).filter((row) => row.id !== "alpaca-paper").map(guard).concat(guard(alpacaRow()));
}

function alpacaRow(): FrameworkHealth {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: "alpaca-paper",
    name: "Alpaca paper",
    version: "paper-api v2",
    license: "Alpaca API terms, not an open-source engine",
    status: "CONFIGURED",
    process: "absent",
    adapter: "present",
    lastConnection: null,
    lastTest: "Overview account read. This registry does not send an order.",
    activeCapability: "MONITORING unless the operator promotes paper.",
    capabilities: ["Account", "clock", "positions"],
    permissions: "Paper host only.",
    errors: [],
    runtime: "Node fetch to paper-api.alpaca.markets",
    health: "Separate from research engines.",
    boundary: "The only execution path.",
    enabled: true,
  };
}

export function disabledInvocation(id: FrameworkId): IntegrationEvent | null {
  if (!disabled.has(id)) return null;
  return { schemaVersion: SCHEMA_VERSION, ts: new Date().toISOString(), framework: id, text: "Invocation refused because the adapter is disabled." };
}

export function sampleHypothesis(): TradeProposal {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: "proposal-daytrader-ko-fixture",
    originFramework: "day-trader-skill",
    strategyId: "scanner-daily",
    strategyVersion: "3d0f4ef",
    instrument: { schemaVersion: SCHEMA_VERSION, symbol: "KO", venue: "us-equity" },
    direction: "long",
    ts: "2026-10-19T13:00:00Z",
    sourceDataTs: "2026-10-16T20:00:00Z",
    entryAssumption: "Offline fixture hit breakout_20d. Not a validated entry.",
    holdingPeriod: "unspecified",
    exitCondition: "Not taken from the scanner.",
    estimatedCostBps: 10,
    provenance: "day-trader-skill tests/fixtures daily-spark-2026-10-19",
    validationStatus: "hypothesis",
    evidenceIds: ["fixture-ko-breakout-20d"],
    executable: false,
  };
}

export function researchContribution(): {
  schemaVersion: typeof SCHEMA_VERSION;
  paperAuto: false;
  riskVerdict: string | null;
  riskReasons: string[];
  plan: { entry?: number; stop?: number; target?: number } | null;
  brokerInvoked: boolean;
  note: string;
} {
  const base = evidenceRoot();
  const workflow = existsSync(join(base, ".runtimes/day-trader-run/workflow.json"))
    ? (JSON.parse(readFileSync(join(base, ".runtimes/day-trader-run/workflow.json"), "utf8")) as { brokerInvoked?: boolean })
    : null;
  const risk = existsSync(join(base, ".runtimes/day-trader-run/risk.json"))
    ? (JSON.parse(readFileSync(join(base, ".runtimes/day-trader-run/risk.json"), "utf8")) as { results?: { verdict?: string; reasons?: string[] }[] })
    : null;
  const plan = existsSync(join(ROOT, ".runtimes/day-trader-run/plan.json"))
    ? (JSON.parse(readFileSync(join(ROOT, ".runtimes/day-trader-run/plan.json"), "utf8")) as { entry?: number; stop?: number; target?: number })
    : null;
  return {
    schemaVersion: SCHEMA_VERSION,
    paperAuto: false,
    riskVerdict: risk?.results?.[0]?.verdict ?? null,
    riskReasons: risk?.results?.[0]?.reasons ?? [],
    plan: plan ? { entry: plan.entry, stop: plan.stop, target: plan.target } : null,
    brokerInvoked: workflow?.brokerInvoked === true,
    note: "Offline day-trader fixtures. The opening-range hit and the Time Machine replay are not probabilities and not a profitability claim. The broker tool was not called.",
  };
}

export function integrationSelfCheck(): { riskIntact: boolean; proposalAccepted: boolean; paperAuto: boolean; leanRan: boolean } {
  const proposal = sampleHypothesis();
  return {
    riskIntact: runPaperSafety().passed,
    proposalAccepted: assessProposal(proposal).accepted,
    paperAuto: paperAutoEligible(proposal),
    leanRan: false,
  };
}

export function staleEvidenceRejected(): string[] {
  return evidenceDefects({
    schemaVersion: SCHEMA_VERSION,
    id: "stale",
    framework: "tradingagents",
    createdAt: "2020-01-01T00:00:00Z",
    sourceDataTs: "2020-01-01T00:00:00Z",
    summary: "No model was called.",
    references: [],
    stale: true,
  });
}
