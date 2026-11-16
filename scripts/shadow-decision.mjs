#!/usr/bin/env node
/**
 * SHADOW runner. Refreshes market data and reconciles PAPER positions.
 * Never submits. Historical command remains scripts/decision-trace.mjs.
 * PowerShell: node --experimental-strip-types scripts/shadow-decision.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { assessBars, barsUrl, reconcilePaperPosition } from "../src/lib/apex/research/shadow.ts";
import { runCanonicalDecision } from "../src/lib/apex/research/canonical-decision.ts";
import { scanUniverse } from "../src/lib/apex/research/scanner.ts";
import { buildProposal } from "../src/lib/apex/research/proposal.ts";
import { PAPER_POST_ENABLED } from "../src/lib/apex/broker/paper-equity-transport.ts";

const env = Object.fromEntries(readFileSync(".env", "utf8").split("\n").filter((l) => l && !l.startsWith("#") && l.includes("=")).map((l) => {
  const i = l.indexOf("=");
  return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")];
}));
const creds = { keyId: env.APCA_API_KEY_ID || "", secret: env.APCA_API_SECRET_KEY || "" };
const headers = { "APCA-API-KEY-ID": creds.keyId, "APCA-API-SECRET-KEY": creds.secret };
async function get(url) {
  const res = await fetch(url, { headers });
  return { status: res.status, body: await res.json().catch(() => null) };
}
async function loadBars(symbol) {
  const res = await get(barsUrl(symbol));
  const rows = Array.isArray(res.body?.bars) ? res.body.bars : [];
  return {
    status: res.status,
    bars: rows.map((b) => ({ date: String(b.t).slice(0, 10), open: Number(b.o), high: Number(b.h), low: Number(b.l), close: Number(b.c) })),
  };
}
const now = Date.now();
const loaded = {};
for (const symbol of ["SPY", "QQQ", "IWM"]) loaded[symbol] = await loadBars(symbol);
const quality = Object.fromEntries(Object.entries(loaded).map(([s, v]) => [s, assessBars(s, v.bars, now)]));
const broker = {};
for (const symbol of ["SPY", "QQQ", "IWM"]) broker[symbol] = await reconcilePaperPosition(creds, symbol, get);
const asOf = quality.SPY.asOf;
const traces = ["SPY", "QQQ", "IWM"].map((symbol) => {
  const dataOk = quality[symbol].dataOk && quality.SPY.dataOk && loaded[symbol].status === 200 && broker[symbol].ok && !!asOf;
  return runCanonicalDecision({
    strategyVersion: "etf-xs-breakout-20-v1",
    symbol,
    bars: loaded[symbol].bars,
    spyBars: loaded.SPY.bars,
    universe: { SPY: loaded.SPY.bars, QQQ: loaded.QQQ.bars, IWM: loaded.IWM.bars },
    asOf: asOf || new Date(now).toISOString(),
    provenance: "alpaca-iex-daily-shadow",
    dataOk,
    proposedNotional: 25,
    broker: { ownedQty: broker[symbol].ownedQty, openExitQty: broker[symbol].openExitQty, asOf: asOf || "" },
  });
});
const scan = scanUniverse({ SPY: loaded.SPY.bars, QQQ: loaded.QQQ.bars, IWM: loaded.IWM.bars }, loaded.SPY.bars);
const report = {
  mode: "SHADOW",
  strategyApproved: false,
  paperPostEnabled: PAPER_POST_ENABLED,
  liveDisabled: true,
  submitted: false,
  scan,
  data: quality,
  broker,
  decisions: traces.map((t) => ({ symbol: t.symbol, recommendation: t.researchRecommendation, reason: t.reason, executionAuthorized: t.executionAuthorized, decisionId: `${t.strategyVersion}:${t.symbol}:${t.asOf}`, proposal: buildProposal(t) })),
};
mkdirSync("research/lab", { recursive: true });
writeFileSync("research/lab/shadow-decision.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify({ mode: "SHADOW", submitted: false, decisions: report.decisions, dataOk: Object.fromEntries(Object.entries(quality).map(([k, v]) => [k, v.dataOk])), brokerOk: Object.fromEntries(Object.entries(broker).map(([k, v]) => [k, v.ok])) }, null, 2));
