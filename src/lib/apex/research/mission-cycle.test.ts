import assert from "node:assert/strict";
import test from "node:test";
import { runMissionCycle, FROZEN_RULES_SHA256 } from "./mission-cycle.ts";
import type { Bar } from "./fmz-bb-rsi.ts";

function bars(n: number): Bar[] {
  const out: Bar[] = [];
  const start = Date.parse("2026-11-01T00:00:00Z");
  for (let i = 0; i < n; i++) out.push({ t: new Date(start + i * 900000).toISOString(), o: 100, h: 101, l: 99, c: 100 });
  return out;
}

test("WAIT with enough bars is NO_TRADE and Sentinel vetoes unapproved strategy", () => {
  const trace = runMissionCycle({ bars: bars(260), nowMs: Date.parse("2026-11-10T00:00:00Z"), pilotExpired: true });
  assert.equal(trace.finalDecision, "NO_TRADE");
  assert.equal(trace.sigma, "PASS");
  assert.equal(trace.sentinel, "VETO");
  assert.equal(trace.pilot, "BLOCKED");
  assert.equal(trace.aiModelCalls, 0);
  assert.equal(trace.brokerWrites, 0);
  assert.equal(trace.agents.length, 13);
  assert.equal(trace.strategy.hash, FROZEN_RULES_SHA256);
});

test("missing candles reject at Sigma", () => {
  const trace = runMissionCycle({ bars: bars(10), nowMs: Date.parse("2026-11-10T00:00:00Z") });
  assert.equal(trace.sigma, "REJECT");
  assert.equal(trace.finalDecision, "NO_TRADE");
});

test("stale data and missing broker still veto", () => {
  const trace = runMissionCycle({ bars: bars(260), nowMs: Date.parse("2026-11-10T00:00:00Z"), stale: true, brokerConnected: false });
  assert.equal(trace.sentinel, "VETO");
  assert.ok(trace.sentinelReasons.includes("stale market data"));
  assert.ok(trace.sentinelReasons.includes("broker connection missing"));
});

test("no strategy approval always vetoes", () => {
  const trace = runMissionCycle({ bars: bars(260), nowMs: Date.parse("2026-11-10T00:00:00Z"), strategyApproved: false });
  assert.ok(trace.sentinelReasons.includes("strategyApproved=false"));
  assert.equal(trace.finalDecision, "NO_TRADE");
});

test("duplicate request is vetoed", () => {
  const trace = runMissionCycle({ bars: bars(260), nowMs: Date.parse("2026-11-10T00:00:00Z"), duplicate: true });
  assert.ok(trace.sentinelReasons.includes("duplicate execution request"));
});

test("Bull and Bear are skipped under billing lock", () => {
  const trace = runMissionCycle({ bars: bars(260), nowMs: Date.parse("2026-11-10T00:00:00Z") });
  for (const role of ["bull", "bear", "atlas", "oracle", "pulse", "volta"]) {
    assert.equal(trace.agents.find((a) => a.role === role)?.status, "SKIPPED");
  }
});
