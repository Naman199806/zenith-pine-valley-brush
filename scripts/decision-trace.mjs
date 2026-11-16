#!/usr/bin/env node
/**
 * Latest full decision trace and all 13 agent statuses.
 * Usage: node scripts/decision-trace.mjs
 * Research only. Does not submit or sign.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { runCanonicalDecision } from "../src/lib/apex/research/canonical-decision.ts";
import { architectureReadiness } from "../src/lib/apex/live/architecture.ts";
import { PAPER_POST_ENABLED } from "../src/lib/apex/broker/paper-equity-transport.ts";

function load(symbol) {
  const doc = JSON.parse(readFileSync(`research/data/raw/yahoo/20261112/${symbol}.json`, "utf8"));
  return doc.bars.slice(-260).map((b) => ({ date: b.date, open: b.open, high: b.high, low: b.low, close: b.close }));
}
const spy = load("SPY");
const qqq = load("QQQ");
const iwm = load("IWM");
const asOf = `${spy.at(-1).date}T20:00:00Z`;
const traces = ["SPY", "QQQ", "IWM"].map((symbol) => runCanonicalDecision({
  strategyVersion: "etf-xs-breakout-20-v1",
  symbol,
  bars: symbol === "SPY" ? spy : symbol === "QQQ" ? qqq : iwm,
  spyBars: spy,
  universe: { SPY: spy, QQQ: qqq, IWM: iwm },
  asOf,
  provenance: "yahoo-chart-v8/20261112",
  dataOk: true,
  proposedNotional: 25,
  broker: { ownedQty: 0, openExitQty: 0, asOf },
}));
const report = {
  asOf,
  strategyApproved: false,
  paperPostEnabled: PAPER_POST_ENABLED,
  stages: architectureReadiness().map((s) => ({ stage: s.stage, ready: s.ready, blockers: s.blockers })),
  decisions: traces.map((t) => ({
    symbol: t.symbol,
    recommendation: t.researchRecommendation,
    reason: t.reason,
    executionAuthorized: t.executionAuthorized,
    agents: t.roles.map((r) => ({ role: r.role, invoked: r.invoked, mode: r.mode, contribution: r.contribution, effect: r.effect })),
  })),
};
mkdirSync("research/lab", { recursive: true });
writeFileSync("research/lab/latest-decision-trace.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  asOf,
  paperPostEnabled: PAPER_POST_ENABLED,
  decisions: report.decisions.map((d) => ({ symbol: d.symbol, recommendation: d.recommendation, reason: d.reason })),
  agents: report.decisions[0].agents.map((a) => `${a.role}:${a.mode}`),
}, null, 2));
