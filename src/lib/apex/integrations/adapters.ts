/**
 * Typed adapters over the existing TESTED engine outputs.
 * Each adapter reads a real process artifact. None can place an order.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SCHEMA_VERSION, type BacktestResult, type ResearchEvidence, type TradeProposal } from "./contracts.ts";
import { evidenceRoot } from "./evidence-root.ts";

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

export function leanBacktest(): BacktestResult | null {
  const summary = readJson(join(evidenceRoot(), ".runtimes/lean-run/apex-lean-summary.json")) as {
    engine?: string;
    pin?: string;
    netProfit?: number;
  } | null;
  if (!summary || summary.engine !== "lean") return null;
  return {
    schemaVersion: SCHEMA_VERSION,
    id: "lean-fixture",
    framework: "lean",
    engineVersion: summary.pin ?? "unknown",
    strategyId: "ApexFixtureAlgorithm",
    strategyVersion: "1",
    datasetChecksum: null,
    metrics: { schemaVersion: SCHEMA_VERSION, netPnlCents: Math.round((summary.netProfit ?? 0) * 100), tradeCount: 1, note: "Synthetic custom-data fixture. Not a validated strategy." },
    log: ".runtimes/lean-run/apex-lean-summary.json",
    actualEngineRun: true,
  };
}

export function backtraderVerify(): BacktestResult | null {
  const report = readJson(join(process.cwd(), "research/integration-report.json")) as {
    runs?: { backtrader?: { sma?: { netPnl?: number; version?: string } } };
  } | null;
  const sma = report?.runs?.backtrader?.sma;
  if (!sma || sma.netPnl == null) return null;
  return {
    schemaVersion: SCHEMA_VERSION,
    id: "backtrader-sma",
    framework: "backtrader",
    engineVersion: sma.version ?? "1.9.78.123",
    strategyId: "sma-2-3",
    strategyVersion: "1",
    datasetChecksum: null,
    metrics: { schemaVersion: SCHEMA_VERSION, netPnlCents: Math.round(sma.netPnl * 100), tradeCount: 2, note: "Independent SMA check. GPL review required before INTEGRATED." },
    log: "research/integration-report.json",
    actualEngineRun: true,
  };
}

export function freqtradeResearch(): BacktestResult | null {
  const report = readJson(join(process.cwd(), "research/integration-report.json")) as {
    runs?: { freqtrade?: { ok?: boolean; tradeCount?: number; version?: string } };
  } | null;
  const ft = report?.runs?.freqtrade;
  if (!ft?.ok) return null;
  return {
    schemaVersion: SCHEMA_VERSION,
    id: "freqtrade-sample",
    framework: "freqtrade",
    engineVersion: ft.version ?? "2026.10",
    strategyId: "SampleStrategy",
    strategyVersion: "1",
    datasetChecksum: null,
    metrics: { schemaVersion: SCHEMA_VERSION, netPnlCents: null, tradeCount: ft.tradeCount ?? null, note: "Synthetic crypto backtest. Dry-run. GPL review pending." },
    log: "research/integration-report.json",
    actualEngineRun: true,
  };
}

export function tradingAgentsEvidence(): { evidence: ResearchEvidence; proposal: TradeProposal } | null {
  const invoke = readJson(join(process.cwd(), ".runtimes/tradingagents-run/invoke.json")) as {
    ok?: boolean;
    signal?: string;
    ticker?: string;
    tradeDate?: string;
  } | null;
  if (!invoke?.ok) return null;
  const now = new Date().toISOString();
  const evidence: ResearchEvidence = {
    schemaVersion: SCHEMA_VERSION,
    id: "ta-evidence",
    framework: "tradingagents",
    createdAt: now,
    sourceDataTs: invoke.tradeDate ?? now,
    summary: `TradingAgents returned ${invoke.signal ?? "no signal"} on ${invoke.ticker ?? "unknown"}. This is a hypothesis.`,
    references: [".runtimes/tradingagents-run/invoke.json"],
    stale: false,
  };
  const proposal: TradeProposal = {
    schemaVersion: SCHEMA_VERSION,
    id: "ta-proposal",
    originFramework: "tradingagents",
    strategyId: "tradingagents-market",
    strategyVersion: "0.7.1",
    instrument: { schemaVersion: SCHEMA_VERSION, symbol: invoke.ticker ?? "AAPL", venue: "research" },
    direction: "flat",
    ts: now,
    sourceDataTs: invoke.tradeDate ?? now,
    entryAssumption: "None. Signal is not an entry.",
    holdingPeriod: "n/a",
    exitCondition: "n/a",
    estimatedCostBps: 0,
    provenance: "tradingagents invoke.json",
    validationStatus: "hypothesis",
    evidenceIds: [evidence.id],
    executable: false,
  };
  return { evidence, proposal };
}

export function dayTraderCandidate(): ResearchEvidence | null {
  const workflow = readJson(join(process.cwd(), ".runtimes/day-trader-run/workflow.json")) as {
    ok?: boolean;
    brokerInvoked?: boolean;
    executable?: boolean;
  } | null;
  if (!workflow?.ok || workflow.brokerInvoked !== false) return null;
  return {
    schemaVersion: SCHEMA_VERSION,
    id: "dt-candidate",
    framework: "day-trader-skill",
    createdAt: new Date().toISOString(),
    sourceDataTs: new Date().toISOString(),
    summary: "Day Trader scanner produced a research candidate. Risk blocked the fixture. Broker was not invoked.",
    references: [".runtimes/day-trader-run/workflow.json"],
    stale: false,
  };
}

export function hermesExperiment(): { id: string; selfDeclaredSuccess: false; hypothesis: string } | null {
  const experiment = readJson(join(process.cwd(), ".runtimes/hermes-run/experiment.json")) as {
    ok?: boolean;
    selfDeclaredSuccess?: boolean;
    hypothesis?: string;
  } | null;
  if (!experiment?.ok || experiment.selfDeclaredSuccess !== false) return null;
  return { id: "hermes-experiment", selfDeclaredSuccess: false, hypothesis: experiment.hypothesis ?? "Post-trade review hypothesis." };
}
