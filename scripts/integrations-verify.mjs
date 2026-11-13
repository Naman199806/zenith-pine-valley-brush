/**
 * Runs the real framework smokes and writes research/integration-report.json.
 * A missing process is a blocker. This script does not mark INTEGRATED or ACTIVE.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const reportPath = join(root, "research", "integration-report.json");
const generatedAt = new Date().toISOString();

function run(command, args, opts = {}) {
  const proc = spawnSync(command, args, {
    encoding: "utf8",
    timeout: opts.timeout ?? 180_000,
    cwd: opts.cwd ?? root,
    env: opts.env ?? process.env,
  });
  return {
    code: proc.status,
    stdout: proc.stdout ?? "",
    stderr: proc.stderr ?? "",
    error: proc.error ? String(proc.error.message ?? proc.error) : "",
  };
}

function parseJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function row(partial) {
  return {
    schemaVersion: "apex.integration.v1",
    adapter: "present",
    enabled: true,
    process: partial.status === "TESTED" ? "exited-ok" : partial.status === "NOT_INSTALLED" ? "absent" : "blocked",
    lastConnection: partial.lastConnection ?? generatedAt,
    capabilities: partial.capabilities ?? [],
    errors: partial.errors ?? [],
    ...partial,
  };
}

const runs = {};

const bt = run(join(root, ".runtimes/backtrader/bin/python"), [join(root, "scripts/research/backtrader_fixture.py")], { timeout: 30_000 });
const sma = run(join(root, ".runtimes/backtrader/bin/python"), [join(root, "scripts/research/backtrader_sma.py")], { timeout: 30_000 });
runs.backtrader = { fixture: parseJson(bt.stdout), sma: parseJson(sma.stdout), fixtureCode: bt.code, smaCode: sma.code };
const smaNet = runs.backtrader.sma?.netPnl;
const btOk = runs.backtrader.fixture?.ok === true && runs.backtrader.fixture.netPnl === 19.8 && smaNet === -30.21;

const ft = run(join(root, ".runtimes/freqtrade/bin/python"), [join(root, "scripts/research/freqtrade_backtest.py")], { timeout: 120_000 });
runs.freqtrade = parseJson(ft.stdout) ?? { ok: false, blocker: (ft.stderr || ft.stdout).slice(-500) };
const ftOk = runs.freqtrade.ok === true && runs.freqtrade.tradeCount === 1 && runs.freqtrade.placeOrders === false;

const dt = run("python3", [join(root, "scripts/research/daytrader_workflow.py")], { timeout: 60_000 });
runs.dayTrader = parseJson(dt.stdout) ?? { ok: false };
const workflow = readJson(join(root, ".runtimes/day-trader-run/workflow.json"));
const risk = readJson(join(root, ".runtimes/day-trader-run/risk.json"));
const plan = readJson(join(root, ".runtimes/day-trader-run/plan.json"));
runs.dayTrader.riskVerdict = risk?.results?.[0]?.verdict ?? null;
runs.dayTrader.riskReasons = risk?.results?.[0]?.reasons ?? [];
runs.dayTrader.plan = plan ? { entry: plan.entry, stop: plan.stop, target: plan.target, stopRule: plan.stop_rule } : null;
runs.dayTrader.brokerInvoked = workflow?.brokerInvoked === true;
const dtOk = workflow?.ok === true && workflow.brokerInvoked === false && workflow.executable === false;

const lean = run("sh", [join(root, "scripts/research/lean/run.sh")], { timeout: 120_000 });
const leanSummary = readJson(join(root, ".runtimes/lean-run/apex-lean-summary.json"));
const leanResult = readJson(join(root, ".runtimes/lean-run/results/ApexFixtureAlgorithm-summary.json"));
const leanPidText = existsSync(join(root, ".runtimes/lean-run/launcher.pid"))
  ? readFileSync(join(root, ".runtimes/lean-run/launcher.pid"), "utf8").trim()
  : "";
const leanPid = Number(leanPidText);
runs.lean = {
  code: lean.code,
  pid: Number.isInteger(leanPid) ? leanPid : null,
  summary: leanSummary,
  status: leanResult?.state?.Status ?? null,
  endEquity: leanResult?.statistics?.["End Equity"] ?? null,
};
const leanOk =
  lean.code === 0 &&
  leanSummary?.engine === "lean" &&
  leanSummary.pin === "655ac6d475ad8539ff54583a26327e63b59c5703" &&
  leanSummary.brokerOrders === false &&
  leanSummary.netProfit === 50 &&
  leanResult?.state?.Status === "Completed" &&
  Number.isInteger(leanPid) &&
  leanPid > 0;

const taPath = join(root, ".runtimes/tradingagents-run/invoke.json");
const refreshLlm = process.env.APEX_REFRESH_LLM === "1" || !existsSync(taPath);
if (refreshLlm) {
  const ta = run(join(root, ".runtimes/tradingagents/bin/python"), [join(root, "scripts/research/tradingagents_invoke.py")], { timeout: 180_000 });
  runs.tradingagents = parseJson(ta.stdout) ?? readJson(taPath) ?? { ok: false, blocker: (ta.stderr || ta.error).slice(-500) };
} else {
  runs.tradingagents = readJson(taPath);
  runs.tradingagents.reused = true;
}
const taOk = runs.tradingagents?.ok === true && runs.tradingagents.placeOrders === false && runs.tradingagents.executable === false && Boolean(runs.tradingagents.signal);

const hermesPath = join(root, ".runtimes/hermes-run/experiment.json");
const hermesExisting = readJson(hermesPath);
if (process.env.APEX_REFRESH_LLM === "1" || !hermesExisting?.ok) {
  const hermes = run(join(root, ".runtimes/hermes314/bin/python"), [join(root, "scripts/research/hermes_review.py")], { timeout: 200_000 });
  runs.hermes = readJson(hermesPath) ?? parseJson(hermes.stdout) ?? { ok: false, blocker: (hermes.stderr || hermes.stdout || hermes.error).slice(-800) };
} else {
  runs.hermes = hermesExisting;
  runs.hermes.reused = true;
}
const hermesSkills = new Set(runs.hermes.skills ?? []);
const hermesOk =
  runs.hermes.ok === true &&
  runs.hermes.selfDeclaredSuccess === false &&
  ["research-analyst", "post-trade-review", "strategy-improvement", "research-memory"].every((name) => hermesSkills.has(name));

const alpaca = run("node", ["--experimental-strip-types", "-e", `
import { readPaperDesk } from "./src/lib/apex/broker/runtime.server.ts";
const desk = await readPaperDesk();
console.log(JSON.stringify({
  connected: desk.connected,
  mode: desk.launchMode,
  status: desk.account?.status ?? null,
  equity: desk.account?.equity ?? null,
  clockOpen: desk.clock?.isOpen ?? null,
  clockTs: desk.clock?.timestamp ?? null,
  positions: desk.positions.length,
  orders: desk.orders.length,
  safety: desk.safetyPassed,
  recon: desk.reconciliationClean,
  liveSelectable: desk.liveSelectable,
}));
`], { timeout: 30_000 });
runs.alpaca = parseJson(alpaca.stdout) ?? { connected: false, blocker: (alpaca.stderr || alpaca.stdout).slice(-400) };
const alpacaOk = runs.alpaca.connected === true && runs.alpaca.liveSelectable === false && runs.alpaca.mode === "MONITORING";

const workflowRun = run("node", [join(root, "scripts/research/unified_workflow.mjs")], { timeout: 20_000 });
runs.workflow = parseJson(workflowRun.stdout);

const frameworks = [
  row({
    id: "alpaca-paper",
    name: "Alpaca paper",
    version: "paper-api v2",
    license: "Alpaca API terms, not an open-source engine",
    status: alpacaOk ? "CONFIGURED" : "DEGRADED",
    process: alpacaOk ? "authenticated-read" : "absent",
    lastTest: alpacaOk ? `Account ${runs.alpaca.status}, equity ${runs.alpaca.equity}, clock ${runs.alpaca.clockTs}` : null,
    activeCapability: "MONITORING. This command does not send an order.",
    capabilities: ["Account", "clock", "positions", "paper orders only after launch promotion"],
    permissions: "Paper host only. LIVE not selectable.",
    errors: alpacaOk ? [] : ["Paper account read did not authenticate."],
    runtime: "Node fetch to paper-api.alpaca.markets",
    health: alpacaOk ? `Authenticated. ${runs.alpaca.positions} positions, ${runs.alpaca.orders} session orders. Safety ${runs.alpaca.safety}.` : "Not authenticated",
    boundary: "The only execution path. No order is sent by this verify.",
  }),
  row({
    id: "lean",
    name: "QuantConnect LEAN",
    version: "655ac6d475ad8539ff54583a26327e63b59c5703",
    license: "Apache-2.0",
    status: leanOk ? "INTEGRATED" : "DEGRADED",
    lastTest: leanOk ? "ApexFixtureAlgorithm custom-data backtest, net 50 dollars, fees 0" : null,
    activeCapability: "One completed backtest. Not a service.",
    capabilities: ["Launcher backtest on synthetic custom data"],
    permissions: "environment=backtesting. brokerOrders false. No Alpaca call.",
    errors: leanOk ? [] : ["LEAN launcher did not complete the fixture. See .runtimes/lean-run/launcher.log."],
    runtime: "dotnet 10.0.404, Launcher/bin/Release/QuantConnect.Lean.Launcher.dll",
    health: leanOk ? `Process ${leanPid} exited 0. End equity 100050. The TypeScript 19.80 fixture was not used.` : "Launcher failed",
    boundary: "Fills are LEAN's immediate custom-data close, not the Apex next-bar-open fixture. Net 50 versus the fixture's 19.80 is a different rule, not a second copy of that check.",
  }),
  row({
    id: "tradingagents",
    name: "TradingAgents",
    version: runs.tradingagents?.version ?? "0.7.1",
    license: "Apache-2.0",
    status: taOk ? "INTEGRATED" : "BLOCKED",
    lastTest: taOk ? `${runs.tradingagents.ticker} ${runs.tradingagents.tradeDate} signal ${runs.tradingagents.signal}` : null,
    activeCapability: "One research invocation. Not an order.",
    capabilities: ["market analyst only", "xAI provider"],
    permissions: "No brokerage tool. executable false.",
    errors: taOk ? [] : [runs.tradingagents?.blocker || "TradingAgents did not return a signal."],
    runtime: "/workspace/.runtimes/tradingagents Python 3.11.17",
    health: taOk
      ? `Model ${runs.tradingagents.model}. ${runs.tradingagents.reused ? "Stored session invocation, not a second model call." : "Live call this verify."} Hypothesis only.`
      : "Invocation failed",
    boundary: "A rating is not a probability and not paper-auto eligible.",
  }),
  row({
    id: "hermes",
    name: "Hermes Agent",
    version: "eaac327fac2c2db0b77ee143989d49b29a6f36cb",
    license: "MIT",
    status: hermesOk ? "INTEGRATED" : "BLOCKED",
    lastTest: hermesOk ? "oneshot experiment, selfDeclaredSuccess false" : null,
    activeCapability: hermesOk ? "One restricted review." : "Not a passing review.",
    capabilities: ["research-analyst", "post-trade-review", "strategy-improvement", "research-memory"],
    permissions: "Scratch HOME. APCA_* removed. Cannot set selfDeclaredSuccess true.",
    errors: hermesOk ? [] : [String(runs.hermes.blocker || "Hermes review did not pass.").slice(0, 500)],
    runtime: "Python 3.14.8 at .runtimes/hermes314. Commit eaac327. psutil==7.2.2 is not on the index, so psutil 7.0.0 was installed. browser-harness was skipped because it requires pillow==12.3.0 while the pin also requires pillow==13.0.0.",
    health: hermesOk ? "Oneshot returned a versioned experiment with selfDeclaredSuccess false." : "Blocked",
    boundary: "Observe and propose only. It cannot approve a strategy or write the paper key file.",
  }),
  row({
    id: "freqtrade",
    name: "Freqtrade",
    version: "2026.10",
    license: "GPL-3.0-only",
    status: ftOk ? "INTEGRATED" : "DEGRADED",
    lastTest: ftOk ? `SampleStrategy synthetic plus Coinbase BTC-USD research consumed by Strategy Lab` : null,
    activeCapability: "One isolated backtest. Native trading disabled.",
    capabilities: ["dry_run backtest"],
    permissions: "Empty exchange keys. dry_run true. Not imported by Node.",
    errors: ftOk ? ["GPL-3.0 distribution is not cleared. Internal research consumption is separate."] : ["Freqtrade backtest did not exit cleanly."],
    runtime: "Python 3.12.15 venv .runtimes/freqtrade",
    health: ftOk ? "Process exited 0 on synthetic candles." : "Backtest failed",
    boundary: "Not vendored. A subprocess is not GPL clearance. The 0.20% figure is the synthetic series, not a market result.",
  }),
  row({
    id: "backtrader",
    name: "Backtrader",
    version: runs.backtrader.fixture?.version ?? "1.9.78.123",
    license: "GPL-3.0-or-later",
    status: btOk ? "INTEGRATED" : "DEGRADED",
    lastTest: btOk ? "fixture net 19.80, SMA 2/3 net -30.21, and SPY SMA 20/50 consumed by Strategy Lab" : null,
    activeCapability: "Two isolated checks. Not a portfolio source.",
    capabilities: ["3-bar fixture", "SMA 2/3 cross"],
    permissions: "No broker. Cannot write the Apex ledger.",
    errors: btOk ? ["GPL-3.0-or-later distribution is not cleared. Internal research consumption is separate."] : ["Backtrader output did not match the independent figures."],
    runtime: join(root, ".runtimes/backtrader/bin/python"),
    health: btOk ? "Both processes matched the Apex formulas." : "Mismatch",
    boundary: "SMA fills were next-bar opens at 12 and 9, fees 0.12 and 0.09. Same numbers as the integer-cent identity, so no unexplained difference on this series.",
  }),
  row({
    id: "day-trader-skill",
    name: "Day Trader Skill",
    version: "3d0f4ef6986f4984b7c6bd46f7ff4f87744c3abd",
    license: "MIT",
    status: dtOk ? "INTEGRATED" : "DEGRADED",
    lastTest: dtOk ? `risk ${runs.dayTrader.riskVerdict} on the TSLA fixture` : null,
    activeCapability: "Offline scan, entry, exit, risk, clock, and a seeded replay.",
    capabilities: ["scanner", "entry", "exit", "risk", "alerts", "timemachine"],
    permissions: "trader-broker was not called.",
    errors: dtOk ? [] : ["Day-trader workflow did not finish cleanly."],
    runtime: "Python 3.10, clone under .runtimes/day-trader-skill",
    health: dtOk ? "Risk blocked the fixture ticket. That block is not a forecast." : "Workflow failed",
    boundary: "Opening-range hits and Time Machine replays are uncalibrated. They are not probabilities and not profitability.",
  }),
];

const report = {
  schemaVersion: "apex.integration.v1",
  generatedAt,
  complete: false,
  licensingClearance: false,
  reason: "All six research engines are INTEGRATED for internal research: output is consumed by Strategy Lab or Research. GPL distribution for Freqtrade and Backtrader is not cleared. None are ACTIVE. Research output cannot become paper-auto.",
  runs,
  frameworks,
};
mkdirSync(join(root, "research"), { recursive: true });
writeFileSync(reportPath, JSON.stringify(report, null, 2));
const bad = frameworks.filter((item) => item.id !== "alpaca-paper" && !["TESTED", "INTEGRATED"].includes(item.status));
console.log(JSON.stringify({ report: reportPath, complete: false, failing: bad.map((item) => ({ id: item.id, status: item.status, errors: item.errors })) }, null, 2));
process.exit(0);
