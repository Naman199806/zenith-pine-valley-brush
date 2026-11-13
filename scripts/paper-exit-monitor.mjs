import { writeFileSync } from "node:fs";

const status = "/tmp/apex-monitor-status.json";
const start = new Date().toISOString();
let beat = 0;

function tick() {
  beat += 1;
  writeFileSync(status, JSON.stringify({
    pid: process.pid,
    experimentId: "apex-smoke-20261113T1826Z",
    started: start,
    beat,
    at: new Date().toISOString(),
    brokerWrites: false,
    healthy: true,
  }));
}

tick();
setInterval(tick, 2000);
