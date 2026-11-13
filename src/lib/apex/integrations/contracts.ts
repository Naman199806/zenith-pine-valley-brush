export const SCHEMA_VERSION = "apex.integration.v1" as const;

export type FrameworkId =
  | "lean"
  | "tradingagents"
  | "hermes"
  | "freqtrade"
  | "backtrader"
  | "day-trader-skill"
  | "alpaca-paper";

export type IntegrationStatus =
  | "NOT_INSTALLED"
  | "INSTALLED"
  | "CONFIGURED"
  | "TESTED"
  | "INTEGRATED"
  | "ACTIVE"
  | "DEGRADED"
  | "BLOCKED";

export type ValidationStatus = "hypothesis" | "rejected" | "human-approved";

export interface InstrumentRef {
  schemaVersion: typeof SCHEMA_VERSION;
  symbol: string;
  venue: string;
}

export interface MarketDataBar {
  schemaVersion: typeof SCHEMA_VERSION;
  symbol: string;
  ts: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MarketDataSnapshot {
  schemaVersion: typeof SCHEMA_VERSION;
  symbol: string;
  asOf: string;
  source: string;
  last: number | null;
  bars: MarketDataBar[];
}

export interface ResearchRequest {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  framework: FrameworkId;
  requestedAt: string;
  symbols: string[];
}

export interface ResearchEvidence {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  framework: FrameworkId;
  createdAt: string;
  sourceDataTs: string;
  summary: string;
  references: string[];
  stale: boolean;
}

export interface StrategySignal {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  framework: FrameworkId;
  strategyId: string;
  strategyVersion: string;
  symbol: string;
  direction: "long" | "flat";
  ts: string;
  sourceDataTs: string;
  validationStatus: ValidationStatus;
  note: string;
}

export interface TradeProposal {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  originFramework: FrameworkId;
  strategyId: string;
  strategyVersion: string;
  instrument: InstrumentRef;
  direction: "long" | "flat";
  ts: string;
  sourceDataTs: string;
  entryAssumption: string;
  holdingPeriod: string;
  exitCondition: string;
  estimatedCostBps: number;
  provenance: string;
  validationStatus: ValidationStatus;
  evidenceIds: string[];
  executable: false;
}

export interface BacktestRequest {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  framework: FrameworkId;
  strategyId: string;
  strategyVersion: string;
}

export interface PerformanceMetrics {
  schemaVersion: typeof SCHEMA_VERSION;
  netPnlCents: number | null;
  tradeCount: number | null;
  note: string;
}

export interface BacktestResult {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  framework: FrameworkId;
  engineVersion: string;
  strategyId: string;
  strategyVersion: string;
  datasetChecksum: string | null;
  metrics: PerformanceMetrics;
  log: string;
  actualEngineRun: boolean;
}

export interface RiskAssessment {
  schemaVersion: typeof SCHEMA_VERSION;
  proposalId: string;
  accepted: boolean;
  reasons: string[];
}

export interface AgentExperiment {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  framework: FrameworkId;
  baselineId: string;
  hypothesis: string;
  createdAt: string;
  selfDeclaredSuccess: false;
}

export interface FrameworkHealth {
  schemaVersion: typeof SCHEMA_VERSION;
  id: FrameworkId;
  name: string;
  version: string | null;
  license: string;
  status: IntegrationStatus;
  process: "absent" | "exited-ok" | "blocked";
  adapter: "present";
  lastConnection: string | null;
  lastTest: string | null;
  activeCapability: string;
  capabilities: string[];
  permissions: string;
  errors: string[];
  runtime: string;
  health: string;
  boundary: string;
  enabled: boolean;
}

export interface IntegrationEvent {
  schemaVersion: typeof SCHEMA_VERSION;
  ts: string;
  framework: FrameworkId;
  text: string;
}
