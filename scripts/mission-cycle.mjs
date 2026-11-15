import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runMissionCycle } from "../src/lib/apex/research/mission-cycle.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(readFileSync(join(root, ".env"), "utf8").split(/\n/).filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => {
  const i = l.indexOf("=");
  return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, "")];
}));
const headers = { "APCA-API-KEY-ID": env.APCA_API_KEY_ID, "APCA-API-SECRET-KEY": env.APCA_API_SECRET_KEY };
const end = new Date();
const start = new Date(end.getTime() - 8 * 24 * 60 * 60 * 1000);
const url = `https://data.alpaca.markets/v1beta3/crypto/us/bars?symbols=BTC/USD&timeframe=15Min&start=${start.toISOString()}&end=${end.toISOString()}&limit=1000&sort=desc`;
const res = await fetch(url, { headers });
const body = await res.json();
if (!res.ok) throw new Error(`bars ${res.status}`);
const raw = (body.bars?.["BTC/USD"] || []).map((b) => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c })).reverse();
const trace = runMissionCycle({ bars: raw, nowMs: Date.now(), strategyApproved: false, pilotExpired: true, billingLocked: true, brokerConnected: true });
trace.market.source = "https://data.alpaca.markets/v1beta3/crypto/us/bars";
mkdirSync(join(root, "research/lab"), { recursive: true });
const path = join(root, "research/lab/mission-control-v1.json");
writeFileSync(path, JSON.stringify(trace, null, 2));
writeFileSync(join(root, "research/lab/hermes-mission-journal.json"), JSON.stringify({ traceId: trace.traceId, decision: trace.finalDecision, savedAt: new Date().toISOString(), note: "journal only; no order" }, null, 2));
console.log(JSON.stringify({ traceId: trace.traceId, decision: trace.finalDecision, sigma: trace.sigma, sentinel: trace.sentinel, bars: trace.market.completedBars, latest: trace.market.latestCompletedCandle, executed: trace.agents.filter((a) => a.invoked).length, ai: trace.aiModelCalls, brokerWrites: trace.brokerWrites, path }, null, 2));
