#!/usr/bin/env node
/**
 * Local health check. Exits 0 only when the frozen execution gate is intact,
 * this process's broker poll is fresh, and reconciliation is OK.
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
const poll = body && body.brokerPoll;
const gateOk = body
  && body.mode === "PAPER_READ_ONLY"
  && body.paperPost === "DISABLED"
  && body.livePost === "DISABLED"
  && body.autonomousStrategyTrading === "DISABLED"
  && body.strategyApproved === false
  && poll
  && poll.stale === false
  && poll.reconciliation
  && poll.reconciliation.outcome === "OK";
if (res.status !== 200 || !gateOk) {
  const outcome = poll && poll.reconciliation ? poll.reconciliation.outcome : "missing";
  const stale = poll ? poll.stale : "missing";
  console.error(`executor health check failed stale=${stale} reconciliation=${outcome}`);
  process.exit(1);
}
console.log("ok");
console.log(`brokerPoll stale=${poll.stale} reconciliation=${poll.reconciliation.outcome} outstandingOrders=${poll.reconciliation.outstandingOrders} unknownOrders=${poll.reconciliation.unknownOrders}`);
if (body.durability != null) {
  console.log(`durability=${body.durability} directoryFsyncSupported=${body.directoryFsyncSupported}`);
}
if (body.durability === "file-only") {
  console.error(body.durabilityWarning || "directory fsync unsupported; durability is file-only");
}
