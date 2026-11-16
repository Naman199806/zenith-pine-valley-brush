#!/usr/bin/env node
/**
 * Local health check. Exits 0 only when the frozen execution gate is intact.
 * Usage: APEX_EXECUTOR_HEALTH_TOKEN=... node services/apex-executor/deploy/healthcheck.mjs
 */
const token = process.env.APEX_EXECUTOR_HEALTH_TOKEN || "";
const port = process.env.APEX_EXECUTOR_PORT || "8787";
if (!token) {
  console.error("APEX_EXECUTOR_HEALTH_TOKEN is required");
  process.exit(1);
}
const res = await fetch(`http://127.0.0.1:${port}/health`, { headers: { "x-executor-token": token } });
const body = await res.json().catch(() => null);
const gateOk = body
  && body.mode === "PAPER_READ_ONLY"
  && body.paperPost === "DISABLED"
  && body.livePost === "DISABLED"
  && body.autonomousStrategyTrading === "DISABLED"
  && body.strategyApproved === false;
if (res.status !== 200 || !gateOk) {
  console.error("executor health check failed");
  process.exit(1);
}
console.log("ok");
