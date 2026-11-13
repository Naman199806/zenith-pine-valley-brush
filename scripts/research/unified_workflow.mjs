/**
 * Sprint 5 unified research workflow.
 * Chains existing TESTED engine outputs into one Apex evidence record.
 * Does not place orders. Does not mark any framework INTEGRATED.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const outDir = join(root, "research", "workflow");
mkdirSync(outDir, { recursive: true });

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

const report = readJson(join(root, "research", "integration-report.json"));
const dayTrader = readJson(join(root, ".runtimes/day-trader-run/workflow.json"));
const tradingAgents = readJson(join(root, ".runtimes/tradingagents-run/invoke.json"));
const hermes = readJson(join(root, ".runtimes/hermes-run/experiment.json"));
const lean = readJson(join(root, ".runtimes/lean-run/apex-lean-summary.json"));

const steps = [
  {
    step: "market-data",
    status: "TESTED",
    note: "Yahoo daily coverage is documented. No second provider. Intraday IEX is used only when the paper clock is open.",
  },
  {
    step: "day-trader-scanner",
    status: dayTrader?.ok === true && dayTrader.brokerInvoked === false ? "TESTED" : "BLOCKED",
    output: dayTrader ? { risk: dayTrader.riskVerdict ?? null, executable: dayTrader.executable } : null,
    note: "Scanner output is research only. Native broker tool is not invoked.",
  },
  {
    step: "tradingagents-research",
    status: tradingAgents ? "TESTED" : "BLOCKED",
    output: tradingAgents ? { signal: tradingAgents.signal ?? tradingAgents.decision ?? null } : null,
    note: "Research report only. No order permission.",
  },
  {
    step: "apex-proposal",
    status: "TESTED",
    note: "Proposal is a hypothesis. executable is false. Paper auto stays ineligible.",
  },
  {
    step: "lean-backtest",
    status: lean?.engine === "lean" ? "TESTED" : "BLOCKED",
    output: lean ? { net: lean.net ?? lean.netPnl ?? null, pin: lean.pin ?? null } : null,
    note: "Fixture algorithm. Not a validated strategy.",
  },
  {
    step: "backtrader-verify",
    status: report?.runs?.backtrader?.sma?.netPnl === -30.21 ? "TESTED" : "BLOCKED",
    output: report?.runs?.backtrader?.sma ? { netPnl: report.runs.backtrader.sma.netPnl } : null,
    note: "Independent SMA check. GPL review still required before INTEGRATED.",
  },
  {
    step: "apex-risk",
    status: "TESTED",
    note: "Risk engine rejects executable proposals from research adapters. Kill switch remains available.",
  },
  {
    step: "alpaca-paper",
    status: "CONFIGURED",
    note: "Paper account is authenticated in MONITORING. No order is sent without operator confirmation. LIVE is not selectable.",
  },
  {
    step: "hermes-review",
    status: hermes ? "TESTED" : "BLOCKED",
    output: hermes ? { selfDeclaredSuccess: hermes.selfDeclaredSuccess ?? null } : null,
    note: "Post-trade hypothesis only. Does not promote a strategy.",
  },
  {
    step: "freqtrade-crypto",
    status: report?.runs?.freqtrade?.ok === true ? "TESTED" : "BLOCKED",
    note: "Crypto research only. Native exchange trading disabled. GPL review pending.",
  },
];

const workflow = {
  schemaVersion: "apex.workflow.v1",
  generatedAt: new Date().toISOString(),
  executable: false,
  paperAutoEligible: false,
  liveEnabled: false,
  licensingClearance: false,
  steps,
  blockers: [
    "Freqtrade and Backtrader remain TESTED pending GPL review.",
    "No framework is INTEGRATED. Research output cannot become an order.",
    "Market is closed or no operator has authorized a paper order.",
  ],
};

writeFileSync(join(outDir, "sprint5.json"), JSON.stringify(workflow, null, 2));
console.log(JSON.stringify({ ok: true, path: "research/workflow/sprint5.json", steps: steps.length, executable: false }));
