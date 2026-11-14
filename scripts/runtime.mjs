import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runNoTrade, runSynthetic } from "../src/lib/apex/runtime/sim.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const synthetic = runSynthetic();
const noTrade = await runNoTrade();
const state = {
  pid: process.pid,
  startedAt: new Date().toISOString(),
  flags: { EXPERIMENT_ON: false, PAPER_AUTO: false, LIVE: false },
  synthetic,
  noTrade: noTrade.decision,
  paidCalls: 0,
  brokerWrites: 0,
};
const statePath = join(root, "research/lab/runtime-state.json");
mkdirSync(dirname(statePath), { recursive: true });
writeFileSync(statePath, JSON.stringify(state, null, 2));
const server = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(state));
});
server.listen(4173, "127.0.0.1", () => {
  console.log(JSON.stringify({ pid: process.pid, url: "http://127.0.0.1:4173" }));
});
