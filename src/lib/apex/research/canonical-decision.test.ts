import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROLES, STRATEGY_REGISTRY, computeVectorSignal, runCanonicalDecision, validateBars, type Bar, type PipelineInput } from "./canonical-decision.ts";

function rising(n: number, start = 100): Bar[] {
  return Array.from({ length: n }, (_, i) => {
    const c = start + i;
    return { date: `2024-${String(Math.floor(i / 28) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`, open: c, high: c + 1, low: c - 0.5, close: c };
  });
}

function breakout(): Bar[] {
  const bars = rising(220);
  const last = bars[bars.length - 1]!;
  bars[bars.length - 1] = { ...last, close: 500, high: 501, low: 499 };
  return bars;
}

const asOf = "2024-12-31T20:00:00Z";
const input = (over: Partial<PipelineInput> = {}): PipelineInput => ({
  strategyVersion: "synthetic-eligible-fixture",
  symbol: "SPY",
  bars: breakout(),
  spyBars: rising(220),
  asOf,
  provenance: "fixture",
  dataOk: true,
  proposedNotional: 25,
  broker: { ownedQty: 0, openExitQty: 0, asOf },
  ...over,
});

test("Sigma and Sentinel ablation blocks new entries", () => {
  const noSigma = runCanonicalDecision(input({ ablation: ["Sigma"] }));
  const noSentinel = runCanonicalDecision(input({ ablation: ["Sentinel"] }));
  assert.equal(noSigma.researchRecommendation, "NO_TRADE");
  assert.equal(noSentinel.researchRecommendation, "NO_TRADE");
  assert.equal(noSigma.roles.find((r) => r.role === "Sigma")!.invoked, false);
  assert.equal(noSentinel.roles.find((r) => r.role === "Sentinel")!.invoked, false);
});

test("NO_WINNER and synthetic fixture cannot be broker-authorized", () => {
  assert.equal(STRATEGY_REGISTRY["etf-xs-breakout-20-v1"].verdict, "NO_WINNER");
  assert.equal(STRATEGY_REGISTRY["etf-xs-breakout-20-v1"].brokerExecutable, false);
  assert.equal(STRATEGY_REGISTRY["synthetic-eligible-fixture"].brokerExecutable, false);
  const rejected = runCanonicalDecision(input({ strategyVersion: "etf-xs-breakout-20-v1" }));
  const synthetic = runCanonicalDecision(input());
  assert.equal(rejected.researchRecommendation, "NO_TRADE");
  assert.equal(synthetic.executionAuthorized, false);
  assert.equal(synthetic.brokerExecutable, false);
  assert.ok(synthetic.reason.includes("Synthetic") || synthetic.reason.includes("cannot"));
});

test("bar validation rejects future, unordered, invalid and non-finite bars", () => {
  assert.ok(validateBars([{ date: "2025-01-01", open: 1, high: 1, low: 1, close: 1 }], asOf, "X"));
  assert.ok(validateBars([{ date: "bad", open: 1, high: 1, low: 1, close: 1 }], asOf, "X"));
  assert.ok(validateBars([{ date: "2024-01-02", open: 1, high: 1, low: 1, close: 1 }, { date: "2024-01-01", open: 1, high: 1, low: 1, close: 1 }], asOf, "X"));
  assert.ok(validateBars([{ date: "2024-01-01", open: Number.NaN, high: 1, low: 1, close: 1 }], asOf, "X"));
});

test("60-day ranking selects the strongest eligible ETF", () => {
  const spy = rising(220, 100);
  const qqq = rising(220, 80);
  const iwm = rising(220, 50);
  qqq[qqq.length - 1] = { ...qqq[qqq.length - 1]!, close: 400, high: 401, low: 399 };
  iwm[iwm.length - 1] = { ...iwm[iwm.length - 1]!, close: iwm[iwm.length - 1]!.close + 5, high: iwm[iwm.length - 1]!.close + 6, low: iwm[iwm.length - 1]!.close + 4 };
  const universe = { SPY: spy, QQQ: qqq, IWM: iwm };
  assert.equal(computeVectorSignal("QQQ", qqq, spy, universe), "BUY");
  assert.equal(computeVectorSignal("IWM", iwm, spy, universe), "WAIT");
});

test("EXIT reconciles broker snapshot and ignores entry cap", () => {
  const bars = rising(220);
  bars[bars.length - 1] = { ...bars[bars.length - 1]!, close: 10, high: 11, low: 9 };
  const ok = runCanonicalDecision(input({ bars, proposedNotional: 100, broker: { ownedQty: 0.5, openExitQty: 0, asOf } }));
  assert.equal(ok.researchRecommendation, "EXIT");
  const dup = runCanonicalDecision(input({ bars, broker: { ownedQty: 0.5, openExitQty: 0.1, asOf } }));
  assert.equal(dup.researchRecommendation, "NO_TRADE");
  assert.ok(dup.reason.includes("Duplicate"));
});

test("unsupported symbol and missing bars do not execute", () => {
  const bad = runCanonicalDecision(input({ symbol: "TSLA", bars: [] }));
  assert.equal(bad.researchRecommendation, "NO_TRADE");
  assert.equal(bad.executionAuthorized, false);
});

test("all 13 roles are represented; unavailable roles are not invoked", () => {
  const t = runCanonicalDecision(input());
  assert.deepEqual(t.roles.map((r) => r.role), [...ROLES]);
  assert.equal(t.roles.find((r) => r.role === "Bull")!.invoked, false);
  assert.equal(t.roles.find((r) => r.role === "Pilot")!.invoked, false);
});

test("Hermes persistence is labeled honestly", () => {
  assert.equal(runCanonicalDecision(input()).hermes.persistence, "in-memory");
  const dir = mkdtempSync(join(tmpdir(), "h-"));
  const path = join(dir, "j.jsonl");
  const t = runCanonicalDecision(input({ journalPath: path }));
  assert.equal(t.hermes.persistence, "persistent");
  assert.equal(readFileSync(path, "utf8").trim().split("\n").length, 1);
  rmSync(dir, { recursive: true, force: true });
});
