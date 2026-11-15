import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { planPaperOrder } from "../src/lib/apex/broker/paper-pipeline.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "research/lab/windows");
mkdirSync(dir, { recursive: true });
const config = JSON.parse(readFileSync(join(root, "research/lab/paper-runtime-disabled.json"), "utf8"));
const lock = join(dir, "runtime.lock");
if (existsSync(lock) && process.env.APEX_RUNTIME_FORCE !== "1") {
  const old = readFileSync(lock, "utf8").trim();
  if (old && old !== String(process.pid)) {
    console.log(JSON.stringify({ status: "LOCKED", pid: old }));
  }
}
writeFileSync(lock, String(process.pid));
const plan = planPaperOrder({
  signal: "WAIT",
  price: 1,
  cash: 0,
  maxNotional: 25,
  strategyApproved: false,
  riskOk: true,
  billingLocked: true,
  authorizationExpiresAt: null,
  nowMs: Date.now(),
  ownedQty: 0,
  endpoint: "https://paper-api.alpaca.markets/v2/orders",
});
const state = {
  pid: process.pid,
  heartbeat: new Date().toISOString(),
  status: "DISABLED",
  config: config.id,
  automatedEntries: false,
  plan,
  brokerWrites: 0,
  reason: config.reason,
};
writeFileSync(join(root, "research/lab/paper-runtime-heartbeat.json"), JSON.stringify(state, null, 2));
console.log(JSON.stringify(state));
