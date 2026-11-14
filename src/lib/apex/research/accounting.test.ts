import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { reconcileBtc } from "./accounting.ts";

describe("performance accounting integrity", () => {
  const trades = JSON.parse(readFileSync("research/lab/strategies/btc-ema20-100-v1-trades.json", "utf8"));
  const original = JSON.parse(readFileSync("research/lab/strategies/btc-ema20-100-v1-report.json", "utf8"));
  const corrected = reconcileBtc(trades, original.baseline.feesPaid);

  it("reconciles the BTC ledger exactly", () => {
    assert.equal(corrected.identityHolds, true);
    assert.equal(corrected.tradeLevelNet, 1155.5493);
    assert.equal(corrected.portfolioEquityChange, 397.4229);
    assert.equal(Math.abs(corrected.tradeLevelNet - corrected.entryFees - corrected.portfolioEquityChange) < 0.05, true);
    assert.equal(corrected.originalEngineEndEquity, 100397.4229);
  });

  it("preserves original hashes, holdouts, and rejected decisions", () => {
    const btcHash = createHash("sha256").update(readFileSync("research/lab/strategies/btc-ema20-100-v1.json")).digest("hex");
    const etfHash = createHash("sha256").update(readFileSync("research/lab/strategies/etf-xs-rs-60-v1.json")).digest("hex");
    const accounting = JSON.parse(readFileSync("research/lab/strategies/btc-ema20-100-v1-accounting-v2.json", "utf8"));
    const benchmarks = JSON.parse(readFileSync("research/lab/strategies/etf-benchmark-accounting-v2.json", "utf8"));
    assert.equal(btcHash, "5e96f81e38beeaa42780e9c3a882ce8209ec314a4d4077366bdffbc6a903344b");
    assert.equal(etfHash, "05104115363c6bc2653f33b2de3ba541c74fed8e3a47f4418f8e34163da28310");
    assert.equal(accounting.originalDecision, "REJECTED");
    assert.equal(benchmarks.originalDecision, "REJECTED");
    assert.equal(benchmarks.holdoutAccessed, false);
    assert.equal(benchmarks.strategyApproved, false);
    assert.equal(benchmarks.totalReturnStatus, "CASH_DISTRIBUTIONS_MODELED");
  });
});
