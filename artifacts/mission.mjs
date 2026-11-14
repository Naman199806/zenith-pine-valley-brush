import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { btcPacket } from "../src/lib/apex/bots/packet.ts";
import { backoffMs, replaceAtomic, snapshot } from "../src/lib/apex/market/live.ts";
import { cycle, ROLES } from "../src/lib/apex/research/roles.ts";
import { runSynthetic } from "../src/lib/apex/runtime/sim.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const eventPath = join(root, "research/lab/mission-events.json");
mkdirSync(dirname(eventPath), { recursive: true });
const mock = { async complete() { return { text: JSON.stringify({ stance: "DEFER" }), tokens: 1 }; } };
const research = await cycle(btcPacket(), mock, { quantOk: true, riskOk: true, strategyApproved: false });
const packet = JSON.parse(readFileSync(join(root, "research/lab/vector-packet.json"), "utf8"));
const cycleId = "cycle-20261113-replay";
const persisted = existsSync(eventPath) ? JSON.parse(readFileSync(eventPath, "utf8")) : null;
const events = persisted?.events ?? [
  ...ROLES.map((role, i) => ({
    event_id: `mock-sub-${role}`,
    cycle_id: cycleId,
    provenance: "MOCK",
    type: "submission",
    source: role,
    destination: "decision",
    timestamp: "2026-11-13T23:00:00.000Z",
    message: research.roles[i]?.reason || "mock role result",
    payload: research.roles[i],
  })),
  ...(runSynthetic().events || []).map((event, i) => ({
    event_id: `synthetic-${event.type.toLowerCase()}`,
    cycle_id: "synthetic-flat",
    provenance: "SYNTHETIC",
    type: event.type,
    source: "runtime",
    destination: "journal",
    timestamp: event.t,
    message: event.detail,
  })),
];
if (!persisted) writeFileSync(eventPath, JSON.stringify({ events }, null, 2));
let market = { fetchedAt: new Date().toISOString(), attempts: 0, quotes: [], lastKnown: [] };
const state = {
  pid: process.pid,
  mode: "REPLAY",
  heartbeat: new Date().toISOString(),
  flags: { EXPERIMENT_ON: false, PAPER_AUTO: false, LIVE: false },
  roles: research.roles,
  noTrade: research.decision,
  synthetic: runSynthetic(),
  edges: events.filter((event) => event.provenance === "MOCK"),
  conversations: [],
  events,
  bars: packet.last30,
  quotes: [],
  market,
  paidCalls: 0,
  brokerWrites: 0,
};
let refreshing = false;
let failures = 0;
async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    const next = await snapshot(fetch, Date.now(), market.lastKnown);
    market = replaceAtomic(market, next);
    state.market = market;
    state.quotes = market.quotes;
    failures = 0;
  } catch {
    failures += 1;
  } finally {
    refreshing = false;
  }
}
await refresh();
setInterval(() => { state.heartbeat = new Date().toISOString(); }, 3000);
setTimeout(function loop() {
  void refresh().finally(() => setTimeout(loop, failures ? backoffMs(failures) : 20000));
}, 20000);
const server = createServer((req, res) => {
  if (req.url === "/state") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(state));
    return;
  }
  res.writeHead(200, { "content-type": "text/html" });
  res.end(readFileSync(join(root, "public/mission.html")));
});
server.listen(4173, "127.0.0.1", () => console.log(JSON.stringify({ pid: process.pid, url: "http://127.0.0.1:4173" })));
