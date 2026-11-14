import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { btcPacket } from "../src/lib/apex/bots/packet.ts";
import { backoffMs, replaceAtomic, snapshot } from "../src/lib/apex/market/live.ts";
import { cycle, ROLES } from "../src/lib/apex/research/roles.ts";
import { loadReplay } from "../src/lib/apex/research/evidence-replay.ts";
import { RESEARCH_STATUS } from "../src/lib/apex/research/research-status.ts";
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
const validated = JSON.parse(readFileSync(join(root, "research/lab/vector-xai-validated.json"), "utf8"));
const bearValidated = JSON.parse(readFileSync(join(root, "research/lab/bear-xai-validated.json"), "utf8"));
const bullBlocked = JSON.parse(readFileSync(join(root, "research/lab/bull-xai-rejection.json"), "utf8"));
const billingLock = JSON.parse(readFileSync(join(root, "research/lab/xai-billing-lock.json"), "utf8"));
const real = {
  vector: { ...validated, source: "REAL API RESEARCH", validation: "ACCEPTED WITH CORRECTION" },
  bear: { ...bearValidated, source: "REAL API RESEARCH", validation: "ACCEPTED" },
};
const roles = research.roles.map((role) => {
  if (role.role === "bull") return {
    ...role,
    provenance: "NONE",
    stance: "PROVIDER_BILLING_BLOCKED",
    reason: "HTTP 402 spending-limit. No research result.",
    source: "BILLING BLOCKED",
    requestId: null,
    chargeUsd: 0,
  };
  const live = real[role.role];
  return live ? {
    ...role,
    provenance: "XAI_API",
    stance: live.parsed.stance,
    reason: live.parsed.findings[0],
    source: "REAL API RESEARCH",
    validation: live.validation,
    requestId: live.providerRequestId,
    chargeUsd: live.chargeUsd,
  } : { ...role, source: "MOCK", status: "NOT LIVE-TESTED" };
});
const strategy = JSON.parse(readFileSync(join(root, "research/lab/strategies/btc-ema20-100-v1-report.json"), "utf8"));
const candidate = JSON.parse(readFileSync(join(root, "research/lab/strategies/etf-xs-rs-60-v1-report.json"), "utf8"));
const accounting = JSON.parse(readFileSync(join(root, "research/lab/strategies/btc-ema20-100-v1-accounting-v2.json"), "utf8"));
const fast = JSON.parse(readFileSync(join(root, "research/lab/fast/throughput.json"), "utf8"));
const smoke = JSON.parse(readFileSync(join(root, "research/lab/smoke-ticket-20261114.json"), "utf8"));
const roundtrip = JSON.parse(readFileSync(join(root, "research/lab/smoke-roundtrip.json"), "utf8"));
const experiment = JSON.parse(readFileSync(join(root, "research/lab/paper-experiment.json"), "utf8"));
const fmz = JSON.parse(readFileSync(join(root, "research/lab/fmz-pilot.json"), "utf8"));
const evidence = loadReplay(root, new Date().toISOString());
const state = {
  pid: process.pid,
  mode: "PAPER_CONNECTED",
  heartbeat: new Date().toISOString(),
  flags: { EXPERIMENT_ON: false, PAPER_AUTO: false, LIVE: false, PAPER_EXPERIMENT: "WAITING" },
  roles,
  noTrade: evidence.decision,
  synthetic: runSynthetic(),
  edges: events.filter((event) => event.provenance === "MOCK"),
  conversations: [],
  events,
  bars: packet.last30,
  quotes: [],
  market,
  paidCalls: 2,
  brokerWrites: 2,
  smoke,
  roundtrip,
  experiment,
  fmz,
  vector: { provenance: "XAI_API", accepted: validated.accepted, validation: "ACCEPTED WITH CORRECTION", stance: validated.parsed.stance, requestId: validated.providerRequestId, chargeUsd: validated.chargeUsd, asOfUtc: validated.parsed.as_of_utc, historical: true },
  bear: { provenance: "XAI_API", accepted: bearValidated.accepted, validation: "ACCEPTED", stance: bearValidated.parsed.stance, requestId: bearValidated.providerRequestId, chargeUsd: bearValidated.chargeUsd, asOfUtc: bearValidated.parsed.as_of_utc, historical: true },
  bull: { status: "PROVIDER_BILLING_BLOCKED", researchProduced: false, runId: bullBlocked.run_id, providerCode: bullBlocked.providerCode },
  billingLock,
  evidence: {
    accepted: evidence.accepted.length,
    rejected: evidence.rejected.length,
    unavailable: evidence.unavailable.length,
    historical: true,
    window: "2026-10-14/2026-11-12",
    decision: evidence.decision,
  },
  researchStatus: RESEARCH_STATUS,
  strategy,
  candidate,
  accounting: accounting.reconciliation,
  fast,
  smoke,
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
