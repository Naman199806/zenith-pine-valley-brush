import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearLock, isSpendingLimit, paidRequestsBlocked, tripLock } from "./billing-lock.ts";
import { decide } from "./decide.ts";
import { reset, runCycle } from "./scheduler.ts";

describe("billing lock", () => {
  it("trips on the spending-limit error and blocks paid requests until both clearances exist", () => {
    const path = join(mkdtempSync(join(tmpdir(), "apex-lock-")), "lock.json");
    assert.equal(isSpendingLimit(402, '{"code":"personal-team-blocked:spending-limit"}'), true);
    assert.equal(isSpendingLimit(402, "other"), false);
    const lock = tripLock(path, { agentId: "bull", runId: "bull-xai-live-smoke-001", at: "2026-11-13T20:00:00Z" });
    assert.equal(lock.status, "PROVIDER_BILLING_BLOCKED");
    assert.equal(paidRequestsBlocked(path), true);
    assert.equal(clearLock(path, { billingConfirmed: "MANUAL_BILLING_CONFIRMED", authorizationId: "" }).ok, false);
    assert.equal(clearLock(path, { billingConfirmed: "", authorizationId: "auth-new" }).ok, false);
    assert.equal(paidRequestsBlocked(path), true);
    assert.equal(clearLock(path, { billingConfirmed: "MANUAL_BILLING_CONFIRMED", authorizationId: "auth-bull-2" }).ok, true);
    assert.equal(paidRequestsBlocked(path), false);
  });

  it("keeps the scheduler on NO_TRADE with zero broker writes after restart", async () => {
    reset();
    const path = join(mkdtempSync(join(tmpdir(), "apex-cycle-")), "cycles.json");
    const lockPath = join(mkdtempSync(join(tmpdir(), "apex-lock-")), "lock.json");
    tripLock(lockPath, { agentId: "bull", runId: "bull-xai-live-smoke-001" });
    const fetchImpl = async () => { throw new Error("paid request must not run while locked"); };
    const blocked = await runCycle("cycle-locked", fetchImpl, path, lockPath);
    const recovered = await runCycle("cycle-locked", fetchImpl, path, lockPath);
    const decision = decide({ instrument: "BTC/USD", quantOk: true, riskOk: true, strategyApproved: false });
    assert.equal(blocked.action, "NO_TRADE");
    assert.equal(blocked.blocked, "PROVIDER_BILLING_BLOCKED");
    assert.equal(blocked.paid, false);
    assert.equal(blocked.brokerWrites, 0);
    assert.equal(recovered.cycleId, blocked.cycleId);
    assert.equal(decision.action, "NO_TRADE");
  });
});
