import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const results = JSON.parse(readFileSync("research/lab/etf-breakout-v1/results.json", "utf8"));
const spec = results.spec;

test("frozen specification is unchanged", () => {
  assert.equal(spec.name, "etf-xs-breakout-20-v1");
  assert.deepEqual(spec.universe, ["SPY", "QQQ", "IWM"]);
  assert.equal(spec.breakout_days, 20);
  assert.equal(spec.trend_sma, 200);
  assert.equal(spec.rank_days, 60);
  assert.equal(spec.exit_low_days, 10);
  assert.equal(spec.exit_sma, 50);
  assert.equal(spec.position_cap, 25);
  assert.deepEqual(spec.holdout, ["2025-01-02", "2026-11-11"]);
});

test("holdout was evaluated once and is not a winner", () => {
  const h = results.segments.holdout.strategy;
  assert.ok(h.total < 0);
  assert.ok(h.profit_factor < 1);
  assert.ok(results.segments.holdout.strategy.total < results.segments.holdout.spy_buy_hold.total);
});

test("provenance checksums are present for all symbols", () => {
  for (const s of spec.universe) {
    assert.equal(results.provenance.symbols[s].checksum.length, 64);
  }
});

test("no strategy approval is implied", () => {
  assert.equal(results.spec.name.includes("v1"), true);
  assert.ok(results.segments.validation.strategy.cagr < results.segments.validation.spy_buy_hold.cagr);
});
