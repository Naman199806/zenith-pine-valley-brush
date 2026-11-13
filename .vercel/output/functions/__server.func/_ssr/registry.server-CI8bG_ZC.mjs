import { n as evidenceRoot, t as SCHEMA_VERSION } from "./evidence-root-I5njIJ2V.mjs";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
//#region node_modules/.nitro/vite/services/ssr/assets/registry.server-CI8bG_ZC.js
var ROOT = process.cwd();
var REPORT = join(ROOT, "research", "integration-report.json");
var disabled = /* @__PURE__ */ new Set();
var EVIDENCE = {
	lean: join(ROOT, ".runtimes/lean-run/apex-lean-summary.json"),
	tradingagents: join(ROOT, ".runtimes/tradingagents-run/invoke.json"),
	hermes: join(ROOT, ".runtimes/hermes-run/experiment.json"),
	freqtrade: join(ROOT, ".runtimes/freqtrade-run/backtest.log"),
	"day-trader-skill": join(ROOT, ".runtimes/day-trader-run/workflow.json")
};
function absent(id, name, license, reason) {
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
		enabled: !disabled.has(id)
	};
}
function guard(row) {
	if (disabled.has(row.id)) return {
		...row,
		enabled: false,
		status: "BLOCKED",
		process: "blocked",
		errors: ["Adapter disabled. It was not invoked."]
	};
	if (row.status === "ACTIVE") return {
		...row,
		status: "DEGRADED",
		errors: [...row.errors, "ACTIVE is not granted. No recurring workflow is monitored."]
	};
	const evidence = EVIDENCE[row.id];
	if ((row.status === "TESTED" || row.status === "DEGRADED") && evidence && !existsSync(evidence)) return {
		...row,
		status: "DEGRADED",
		errors: [...row.errors, "Evidence file is missing."]
	};
	return {
		...row,
		enabled: !disabled.has(row.id)
	};
}
function integrationHealth() {
	if (!existsSync(REPORT)) return [
		absent("lean", "QuantConnect LEAN", "Apache-2.0", "Run npm run integrations:verify."),
		absent("tradingagents", "TradingAgents", "Apache-2.0", "Run npm run integrations:verify."),
		absent("hermes", "Hermes Agent", "MIT", "Run npm run integrations:verify."),
		absent("freqtrade", "Freqtrade", "GPL-3.0-only", "Run npm run integrations:verify."),
		absent("backtrader", "Backtrader", "GPL-3.0-or-later", "Run npm run integrations:verify."),
		absent("day-trader-skill", "Day Trader Skill", "MIT", "Run npm run integrations:verify.")
	];
	return (JSON.parse(readFileSync(REPORT, "utf8")).frameworks ?? []).filter((row) => row.id !== "alpaca-paper").map(guard).concat(guard(alpacaRow()));
}
function alpacaRow() {
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
		capabilities: [
			"Account",
			"clock",
			"positions"
		],
		permissions: "Paper host only.",
		errors: [],
		runtime: "Node fetch to paper-api.alpaca.markets",
		health: "Separate from research engines.",
		boundary: "The only execution path.",
		enabled: true
	};
}
function researchContribution() {
	const base = evidenceRoot();
	const workflow = existsSync(join(base, ".runtimes/day-trader-run/workflow.json")) ? JSON.parse(readFileSync(join(base, ".runtimes/day-trader-run/workflow.json"), "utf8")) : null;
	const risk = existsSync(join(base, ".runtimes/day-trader-run/risk.json")) ? JSON.parse(readFileSync(join(base, ".runtimes/day-trader-run/risk.json"), "utf8")) : null;
	const plan = existsSync(join(ROOT, ".runtimes/day-trader-run/plan.json")) ? JSON.parse(readFileSync(join(ROOT, ".runtimes/day-trader-run/plan.json"), "utf8")) : null;
	return {
		schemaVersion: SCHEMA_VERSION,
		paperAuto: false,
		riskVerdict: risk?.results?.[0]?.verdict ?? null,
		riskReasons: risk?.results?.[0]?.reasons ?? [],
		plan: plan ? {
			entry: plan.entry,
			stop: plan.stop,
			target: plan.target
		} : null,
		brokerInvoked: workflow?.brokerInvoked === true,
		note: "Offline day-trader fixtures. The opening-range hit and the Time Machine replay are not probabilities and not a profitability claim. The broker tool was not called."
	};
}
//#endregion
export { integrationHealth, researchContribution };
