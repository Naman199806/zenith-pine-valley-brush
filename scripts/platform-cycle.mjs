import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runAgents } from "../src/lib/apex/research/agent-adapters.ts";
import { backtestFmz } from "../src/lib/apex/research/fmz-backtest.ts";
import { runMissionCycle } from "../src/lib/apex/research/mission-cycle.ts";
import { liveReadiness } from "../src/lib/apex/broker/live-guard.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(readFileSync(join(root, ".env"), "utf8").split(/\n/).filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, "")]; }));
const headers = { "APCA-API-KEY-ID": env.APCA_API_KEY_ID, "APCA-API-SECRET-KEY": env.APCA_API_SECRET_KEY };
async function bars(start, end) {
  const url = `https://data.alpaca.markets/v1beta3/crypto/us/bars?symbols=BTC/USD&timeframe=15Min&start=${start}&end=${end}&limit=1000&sort=asc`;
  const res = await fetch(url, { headers });
  const body = await res.json();
  if (!res.ok) throw new Error(`bars ${res.status}`);
  return (body.bars?.["BTC/USD"] || []).map((b) => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c }));
}
const end = new Date();
const start = new Date(end.getTime() - 20 * 24 * 60 * 60 * 1000);
const chunk = 5 * 24 * 60 * 60 * 1000;
const all = [];
for (let t = start.getTime(); t < end.getTime(); t += chunk) {
  all.push(...await bars(new Date(t).toISOString(), new Date(Math.min(t + chunk, end.getTime())).toISOString()));
}
const uniq = [...new Map(all.map((b) => [b.t, b])).values()].sort((a, b) => a.t.localeCompare(b.t));
const agents = runAgents({ symbol: "BTC/USD", bars: uniq, nowMs: Date.now(), billingLockPath: join(root, "research/lab/xai-billing-lock.json"), hasMacro: false, hasNews: false, hasDerivatives: false, hasFundamentals: false });
const trace = runMissionCycle({ bars: uniq, strategyApproved: false, pilotExpired: true, billingLocked: true });
const research = backtestFmz(uniq, 25);
const report = { traceId: trace.traceId, agents, decision: trace, research, live: liveReadiness(), brokerWrites: 0, aiModelCalls: 0 };
writeFileSync(join(root, "research/lab/platform-cycle.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ bars: uniq.length, decision: trace.finalDecision, sigma: trace.sigma, sentinel: trace.sentinel, research, aiModelCalls: 0, brokerWrites: 0 }, null, 2));
