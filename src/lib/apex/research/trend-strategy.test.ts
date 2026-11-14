import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { ema, runTrend } from "./trend-strategy.ts";

describe("frozen BTC trend strategy", () => {
  const raw = JSON.parse(readFileSync("research/data/raw/coinbase/20261112/BTC-USD.json", "utf8"));
  const completed = raw.bars.filter((b) => new Date(b.ts * 1000).toISOString().slice(0, 10) <= "2026-11-12");
  const research = completed.slice(0, completed.length - 60);
  const report = runTrend(research, 690, 25, 5);

  it("uses only completed non-holdout bars and next-bar fills", () => {
    assert.equal(research.length, 987);
    assert.equal(new Date(research[research.length - 1].ts * 1000).toISOString().slice(0, 10), "2026-09-13");
    assert.equal(ema([1, 2, 3, 4, 5], 3).length, 5);
    assert.equal(report.trades.every((t) => t.entryDate > "2024-01-01"), true);
  });

  it("rejects the candidate after costs without promoting it", () => {
    const manifest = JSON.parse(readFileSync("research/lab/strategies/btc-ema20-100-v1.json", "utf8"));
    const result = JSON.parse(readFileSync("research/lab/strategies/btc-ema20-100-v1-report.json", "utf8"));
    assert.equal(manifest.rules.aiEntries, false);
    assert.equal(result.decision, "REJECTED");
    assert.equal(result.strategyApproved, false);
    assert.equal(result.baseline.netReturn < result.baseline.buyAndHold, true);
    assert.equal(result.stress2x.netReturn < 0, true);
  });
});
