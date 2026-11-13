import { n as evidenceRoot, t as SCHEMA_VERSION } from "./evidence-root-I5njIJ2V.mjs";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
//#region node_modules/.nitro/vite/services/ssr/assets/workflow-Dio578_c.js
function proposalDefects(proposal) {
	const reasons = [];
	if (proposal.schemaVersion !== "apex.integration.v1") reasons.push("Schema version is not supported.");
	if (!proposal.id || !proposal.ts || !proposal.sourceDataTs) reasons.push("Identity or timestamps are missing.");
	if (!proposal.instrument?.symbol) reasons.push("Instrument is missing.");
	if (proposal.executable !== false) reasons.push("A research proposal cannot be executable.");
	if (proposal.validationStatus !== "human-approved" && proposal.validationStatus !== "hypothesis" && proposal.validationStatus !== "rejected") reasons.push("Validation status is not recognized.");
	if (proposal.validationStatus === "hypothesis") reasons.push("A hypothesis is not an approved trade.");
	if (proposal.validationStatus === "rejected") reasons.push("A rejected proposal cannot proceed.");
	if (proposal.evidenceIds.length === 0) reasons.push("Evidence is required.");
	if (!Number.isFinite(proposal.estimatedCostBps) || proposal.estimatedCostBps < 0) reasons.push("Estimated cost is missing.");
	return reasons;
}
function assessProposal(proposal) {
	const reasons = proposalDefects(proposal);
	return {
		schemaVersion: SCHEMA_VERSION,
		proposalId: proposal.id,
		accepted: reasons.length === 0 && proposal.validationStatus === "human-approved",
		reasons
	};
}
/** Research output is never paper-auto eligible. Human approval still needs the Alpaca launch gate. */
function paperAutoEligible(proposal) {
	if (proposal.originFramework === "alpaca-paper") return false;
	if (proposal.validationStatus !== "human-approved") return false;
	return false;
}
/**
* Typed adapters over the existing TESTED engine outputs.
* Each adapter reads a real process artifact. None can place an order.
*/
function readJson(path) {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return null;
	}
}
function leanBacktest() {
	const summary = readJson(join(evidenceRoot(), ".runtimes/lean-run/apex-lean-summary.json"));
	if (!summary || summary.engine !== "lean") return null;
	return {
		schemaVersion: SCHEMA_VERSION,
		id: "lean-fixture",
		framework: "lean",
		engineVersion: summary.pin ?? "unknown",
		strategyId: "ApexFixtureAlgorithm",
		strategyVersion: "1",
		datasetChecksum: null,
		metrics: {
			schemaVersion: SCHEMA_VERSION,
			netPnlCents: Math.round((summary.netProfit ?? 0) * 100),
			tradeCount: 1,
			note: "Synthetic custom-data fixture. Not a validated strategy."
		},
		log: ".runtimes/lean-run/apex-lean-summary.json",
		actualEngineRun: true
	};
}
function backtraderVerify() {
	const sma = readJson(join(process.cwd(), "research/integration-report.json"))?.runs?.backtrader?.sma;
	if (!sma || sma.netPnl == null) return null;
	return {
		schemaVersion: SCHEMA_VERSION,
		id: "backtrader-sma",
		framework: "backtrader",
		engineVersion: sma.version ?? "1.9.78.123",
		strategyId: "sma-2-3",
		strategyVersion: "1",
		datasetChecksum: null,
		metrics: {
			schemaVersion: SCHEMA_VERSION,
			netPnlCents: Math.round(sma.netPnl * 100),
			tradeCount: 2,
			note: "Independent SMA check. GPL review required before INTEGRATED."
		},
		log: "research/integration-report.json",
		actualEngineRun: true
	};
}
function freqtradeResearch() {
	const ft = readJson(join(process.cwd(), "research/integration-report.json"))?.runs?.freqtrade;
	if (!ft?.ok) return null;
	return {
		schemaVersion: SCHEMA_VERSION,
		id: "freqtrade-sample",
		framework: "freqtrade",
		engineVersion: ft.version ?? "2026.10",
		strategyId: "SampleStrategy",
		strategyVersion: "1",
		datasetChecksum: null,
		metrics: {
			schemaVersion: SCHEMA_VERSION,
			netPnlCents: null,
			tradeCount: ft.tradeCount ?? null,
			note: "Synthetic crypto backtest. Dry-run. GPL review pending."
		},
		log: "research/integration-report.json",
		actualEngineRun: true
	};
}
function tradingAgentsEvidence() {
	const invoke = readJson(join(process.cwd(), ".runtimes/tradingagents-run/invoke.json"));
	if (!invoke?.ok) return null;
	const now = (/* @__PURE__ */ new Date()).toISOString();
	const evidence = {
		schemaVersion: SCHEMA_VERSION,
		id: "ta-evidence",
		framework: "tradingagents",
		createdAt: now,
		sourceDataTs: invoke.tradeDate ?? now,
		summary: `TradingAgents returned ${invoke.signal ?? "no signal"} on ${invoke.ticker ?? "unknown"}. This is a hypothesis.`,
		references: [".runtimes/tradingagents-run/invoke.json"],
		stale: false
	};
	return {
		evidence,
		proposal: {
			schemaVersion: SCHEMA_VERSION,
			id: "ta-proposal",
			originFramework: "tradingagents",
			strategyId: "tradingagents-market",
			strategyVersion: "0.7.1",
			instrument: {
				schemaVersion: SCHEMA_VERSION,
				symbol: invoke.ticker ?? "AAPL",
				venue: "research"
			},
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
			executable: false
		}
	};
}
function dayTraderCandidate() {
	const workflow = readJson(join(process.cwd(), ".runtimes/day-trader-run/workflow.json"));
	if (!workflow?.ok || workflow.brokerInvoked !== false) return null;
	return {
		schemaVersion: SCHEMA_VERSION,
		id: "dt-candidate",
		framework: "day-trader-skill",
		createdAt: (/* @__PURE__ */ new Date()).toISOString(),
		sourceDataTs: (/* @__PURE__ */ new Date()).toISOString(),
		summary: "Day Trader scanner produced a research candidate. Risk blocked the fixture. Broker was not invoked.",
		references: [".runtimes/day-trader-run/workflow.json"],
		stale: false
	};
}
function hermesExperiment() {
	const experiment = readJson(join(process.cwd(), ".runtimes/hermes-run/experiment.json"));
	if (!experiment?.ok || experiment.selfDeclaredSuccess !== false) return null;
	return {
		id: "hermes-experiment",
		selfDeclaredSuccess: false,
		hypothesis: experiment.hypothesis ?? "Post-trade review hypothesis."
	};
}
/**
* End-to-end research demonstration through Apex contracts.
* Invokes adapters, runs the risk gate, and refuses any order path.
*/
function runUnifiedWorkflow() {
	const lean = leanBacktest();
	const backtrader = backtraderVerify();
	const freqtrade = freqtradeResearch();
	const agents = tradingAgentsEvidence();
	const dayTrader = dayTraderCandidate();
	const hermes = hermesExperiment();
	const proposal = agents?.proposal ?? null;
	const assessment = proposal ? assessProposal(proposal) : null;
	const auto = proposal ? paperAutoEligible(proposal) : false;
	const result = {
		schemaVersion: "apex.workflow.v1",
		generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
		executable: false,
		paperAutoEligible: auto,
		liveEnabled: false,
		adapters: {
			lean: lean ? "invoked" : "missing",
			backtrader: backtrader ? "invoked" : "missing",
			freqtrade: freqtrade ? "invoked" : "missing",
			tradingagents: agents ? "invoked" : "missing",
			dayTrader: dayTrader ? "invoked" : "missing",
			hermes: hermes ? "invoked" : "missing"
		},
		proposalAccepted: assessment?.accepted ?? false,
		proposalReasons: assessment?.reasons ?? [],
		hermesCanApprove: false,
		alpacaIsSoleBroker: true
	};
	const dir = join(process.cwd(), "research", "workflow");
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "adapters.json"), JSON.stringify(result, null, 2));
	return result;
}
//#endregion
export { runUnifiedWorkflow };
