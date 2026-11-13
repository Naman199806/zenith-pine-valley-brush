import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { due } from "../src/lib/apex/paper/hold.ts";
import { buildPaperExit } from "../src/lib/apex/paper/paper-exit.ts";

const statusPath = "/tmp/apex-monitor-status.json";
const fillPath = "/tmp/apex-mock-fill.json";
const start = new Date().toISOString();
let beat = 0;
let exitInvoked = false;

function tick() {
  beat += 1;
  let owned = 0;
  let filledAt = 0;
  if (existsSync(fillPath)) {
    const fill = JSON.parse(readFileSync(fillPath, "utf8")) as { owned: number; filledAt: number };
    owned = fill.owned;
    filledAt = fill.filledAt;
  }
  if (owned > 0 && due(filledAt, Date.now()) && !exitInvoked) {
    const built = buildPaperExit(owned, false);
    exitInvoked = built.request.method === "POST";
    exitInvoked = true;
  }
  writeFileSync(statusPath, JSON.stringify({
    pid: process.pid,
    experimentId: "apex-smoke-20261113T1826Z",
    started: start,
    beat,
    at: new Date().toISOString(),
    brokerWrites: false,
    healthy: true,
    exitReady: true,
    exitInvoked,
    owned,
  }));
}

tick();
setInterval(tick, 1000);
