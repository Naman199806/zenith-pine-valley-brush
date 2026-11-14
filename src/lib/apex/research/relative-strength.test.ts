import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { align, runRelativeStrength } from "./relative-strength.ts";

const load = (symbol: string) => {
  const raw = JSON.parse(readFileSync(`research/data/raw/yahoo/20261112/${symbol}.json`, "utf8"));
  return raw.bars.filter((b: { date: string }) => b.date <= "2025-11-10");
};

describe("frozen ETF relative-strength experiment", () => {
  const symbols = ["SPY", "QQQ", "IWM", "GLD", "TLT"];
  const series = Object.fromEntries(symbols.map((s) => [s, load(s)]));
  const report = runRelativeStrength(series, symbols, 3694, 5, 1);

  it("uses only pre-holdout aligned bars and a frozen manifest", () => {
    const rows = align(series, symbols);
    assert.equal(rows.length, 5278);
    assert.equal(rows.at(-1)?.[0].date <= "2025-11-10", true);
    const hash = createHash("sha256").update(readFileSync("research/lab/strategies/etf-xs-rs-60-v1.json")).digest("hex");
    assert.equal(hash, "05104115363c6bc2653f33b2de3ba541c74fed8e3a47f4418f8e34163da28310");
    assert.equal(report.trades.every((t) => t.exitDate > t.entryDate), true);
  });

  it("rejects the candidate for failing the frozen benchmark gate and leaves the BTC experiment untouched", () => {
    const result = JSON.parse(readFileSync("research/lab/strategies/etf-xs-rs-60-v1-report.json", "utf8"));
    const btc = createHash("sha256").update(readFileSync("research/lab/strategies/btc-ema20-100-v1.json")).digest("hex");
    assert.equal(result.decision, "REJECTED");
    assert.equal(result.strategyApproved, false);
    assert.equal(result.baseline.netReturn < result.baseline.spyBuyAndHold, true);
    assert.equal(result.holdoutAccessed, false);
    assert.equal(btc, "5e96f81e38beeaa42780e9c3a882ce8209ec314a4d4077366bdffbc6a903344b");
  });
});
