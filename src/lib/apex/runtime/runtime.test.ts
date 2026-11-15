import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireLock, heartbeatAgeSeconds, releaseLock } from "./lock.ts";
import { evaluateRuntime } from "./evaluate.ts";
import { planPaperOrder } from "../broker/paper-pipeline.ts";

function bar(t: string, c = 100) { return { t, o: c, h: c + 1, l: c - 1, c }; }

test("heartbeat age advances and stale detection works", () => {
  const first = "2026-11-15T00:00:00.000Z";
  const second = "2026-11-15T00:00:30.000Z";
  assert.ok(heartbeatAgeSeconds(first, Date.parse(second)) >= 30);
  assert.ok(heartbeatAgeSeconds(first, Date.parse("2026-11-15T00:02:00.000Z")) > 90);
});

test("single instance rejects a live pid and recovers a dead pid", () => {
  const dir = mkdtempSync(join(tmpdir(), "apex-lock-"));
  const path = join(dir, "runtime.lock");
  const first = acquireLock(path, 111, new Date(), () => false);
  assert.equal(first.acquired, true);
  const blocked = acquireLock(path, 222, new Date(), (pid) => pid === 111);
  assert.equal(blocked.acquired, false);
  assert.equal(blocked.existingPid, 111);
  const recovered = acquireLock(path, 333, new Date(), () => false);
  assert.equal(recovered.acquired, true);
  assert.equal(recovered.recovered, true);
  releaseLock(path, 333);
});

test("real completed bars produce a vetoed zero-write decision", () => {
  const bars = Array.from({ length: 260 }, (_, i) => bar(new Date(Date.UTC(2026, 0, 1) + i * 15 * 60 * 1000).toISOString(), 100 + (i % 7)));
  const result = evaluateRuntime({ bars, nowMs: Date.parse("2026-11-15T00:00:00Z"), price: 100, cash: 1000, authorizationExpiresAt: "2026-11-15T03:05:00Z" });
  assert.equal(result.cycle.market.completedBars >= 250, true);
  assert.equal(result.cycle.sentinel, "VETO");
  assert.equal(result.plan.action, "NO_TRADE");
  assert.equal(result.brokerWrites, 0);
  assert.equal(result.cycle.aiModelCalls, 0);
});

test("expired authorization cannot create an entry", () => {
  const plan = planPaperOrder({ signal: "BUY", price: 100, cash: 1000, maxNotional: 25, strategyApproved: true, riskOk: true, billingLocked: true, authorizationExpiresAt: "2026-11-15T03:05:00Z", nowMs: Date.parse("2026-11-15T04:00:00Z"), ownedQty: 0, endpoint: "https://paper-api.alpaca.markets/v2/orders" });
  assert.equal(plan.action, "NO_TRADE");
  assert.match(plan.reason, /expired/);
  assert.equal(plan.brokerWrites, 0);
});

test("stale lock file is ignored after recovery", () => {
  const dir = mkdtempSync(join(tmpdir(), "apex-stale-"));
  const path = join(dir, "runtime.lock");
  writeFileSync(path, JSON.stringify({ pid: 999999, heartbeat: "2020-01-01T00:00:00.000Z" }));
  const recovered = acquireLock(path, 444, new Date(), () => false);
  assert.equal(recovered.acquired, true);
  assert.equal(JSON.parse(readFileSync(path, "utf8")).pid, 444);
});
