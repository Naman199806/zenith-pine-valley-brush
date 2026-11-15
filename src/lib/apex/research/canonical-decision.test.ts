import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROLES, STRATEGY_REGISTRY, computeVectorSignal, runCanonicalDecision, type Bar, type PipelineInput } from "./canonical-decision.ts";

function rising(n: number, start = 100): Bar[] {
  return Array.from({ length: n }, (_, i) => ({ date: `2024-01-${String(i + 1).padStart(2, "0")}`, open: start + i, high: start + i + 1, low: start + i - 1, close: start + i }));
}

function breakout(): { bars: Bar[]; spy: Bar[] } {
  const bars = rising(210, 100);
  bars[bars.length - 1] = { ...bars[bars.length - 1]!, close: 400, high: 401, low: 399 };
  return { bars, spy: rising(210, 100) };
}

function exitBars(): { bars: Bar[]; spy: Bar[] } {
  const bars = rising(210, 100);
  bars[bars.length - 1] = { ...bars[bars.length - 1]!, close: 50, high: 51, low: 49 };
  return { bars, spy: rising(210, 100) };
}

const input = (over: Partial<PipelineInput> = {}): PipelineInput => {
  const { bars, spy } = breakout();
  return {
    strategyVersion: "synthetic-eligible-fixture",
    symbol: "SPY",
    bars,
    spyBars: spy,
    asOf: "2024-06-14T20:00:00Z",
    provenance: "fixture",
    dataOk: true,
    ownedQty: 0,
    filledQty: 0,
    openExitQty: 0,
    proposedNotional: 25,
    ...over,
  };
};

test("Vector computes the signal; caller cannot supply BUY", () => {
  const { bars, spy } = breakout();
  assert.equal(computeVectorSignal(bars, spy), "BUY");
  const stale = computeVectorSignal(bars.slice(0, 50), spy.slice(0, 50));
  assert.equal(stale, "WAIT");
  const t = runCanonicalDecision(input());
  assert.equal(t.roles.find((r) => r.role === "Vector")!.output.signal, "BUY");
});

test("NO_WINNER never qualifies for a strategy-driven BUY", () => {
  assert.equal(STRATEGY_REGISTRY["etf-xs-breakout-20-v1"].verdict, "NO_WINNER");
  const t = runCanonicalDecision(input({ strategyVersion: "etf-xs-breakout-20-v1", dataOk: true }));
  assert.equal(t.researchRecommendation, "NO_TRADE");
  assert.equal(t.quantRejects, true);
  assert.ok(t.reason.includes("NO_WINNER"));
});

test("synthetic fixture BUY is labeled and not execution-authorized", () => {
  const t = runCanonicalDecision(input());
  assert.equal(t.researchRecommendation, "BUY");
  assert.ok(t.reason.includes("Synthetic"));
  assert.equal(t.executionAuthorized, false);
  assert.equal(STRATEGY_REGISTRY["synthetic-eligible-fixture"].label.includes("Not a real"), true);
});

test("EXIT of verified owned position survives rejected strategy", () => {
  const { bars, spy } = exitBars();
  const t = runCanonicalDecision(input({
    strategyVersion: "etf-xs-breakout-20-v1",
    bars, spyBars: spy,
    ownedQty: 0.02, filledQty: 0.02, openExitQty: 0,
  }));
  assert.equal(t.researchRecommendation, "EXIT");
  assert.equal(t.executionAuthorized, false);
});

test("duplicate exit and oversized sell are vetoed", () => {
  const { bars, spy } = exitBars();
  const dup = runCanonicalDecision(input({ bars, spyBars: spy, ownedQty: 0.02, filledQty: 0.02, openExitQty: 0.01 }));
  assert.equal(dup.researchRecommendation, "NO_TRADE");
  assert.equal(dup.riskRejects, true);
});

test("unavailable roles are not marked as executed analyses", () => {
  const t = runCanonicalDecision(input());
  for (const name of ["Atlas", "Oracle", "Pulse", "Volta", "Bull", "Bear", "Pilot"] as const) {
    const r = t.roles.find((x) => x.role === name)!;
    assert.equal(r.invoked, false);
    assert.notEqual(r.mode, "DETERMINISTIC");
  }
  assert.equal(t.roles.length, 13);
  assert.deepEqual(t.roles.map((r) => r.role), [...ROLES]);
});

test("ablation removes Vector output rather than rewriting a caller signal", () => {
  const on = runCanonicalDecision(input());
  const off = runCanonicalDecision(input({ disabled: ["Vector"] }));
  assert.equal(on.researchRecommendation, "BUY");
  assert.equal(off.roles.find((r) => r.role === "Vector")!.invoked, false);
  assert.equal(off.researchRecommendation, "NO_TRADE");
});

test("Hermes is persistent only when a journal path is written", () => {
  const mem = runCanonicalDecision(input());
  assert.equal(mem.hermes.persistence, "in-memory");
  const dir = mkdtempSync(join(tmpdir(), "hermes-"));
  const path = join(dir, "journal.jsonl");
  const t = runCanonicalDecision(input({ journalPath: path }));
  assert.equal(t.hermes.persistence, "persistent");
  const again = runCanonicalDecision(input({ journalPath: path, asOf: "2024-06-15T20:00:00Z" }));
  const lines = readFileSync(path, "utf8").trim().split("\n");
  assert.equal(lines.length, 2);
  assert.equal(again.hermes.recorded, true);
  rmSync(dir, { recursive: true, force: true });
});

test("data-stale proposal is rejected", () => {
  const t = runCanonicalDecision(input({ dataOk: false }));
  assert.equal(t.researchRecommendation, "NO_TRADE");
  assert.equal(t.quantRejects, true);
});
