import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buy, sell } from "./costs.ts";
import { entitle } from "./distributions.ts";
import { runTrend } from "./trend-strategy.ts";

describe("canonical cost and distribution accounting", () => {
  it("counts slippage in the fill and commission once as cash", () => {
    const entry = buy(100, 2, { commissionBps: 25, slippageBps: 5 });
    const exit = sell(110, 2, { commissionBps: 25, slippageBps: 5 });
    assert.equal(entry.execution, 100.05);
    assert.equal(Math.abs(entry.commission - 0.50025) < 0.0001, true);
    assert.equal(Math.abs(exit.execution - 109.945) < 1e-9, true);
    const cashChange = -entry.cashOutflow - exit.cashOutflow;
    const tradeNet = -exit.cashOutflow - 2 * entry.execution - entry.commission;
    assert.equal(Math.abs(cashChange - tradeNet) < 1e-9, true);
  });

  it("is a no-op when commission and slippage are zero", () => {
    const entry = buy(50, 4, { commissionBps: 0, slippageBps: 0 });
    const exit = sell(55, 4, { commissionBps: 0, slippageBps: 0 });
    assert.equal(entry.execution, 50);
    assert.equal(entry.commission, 0);
    assert.equal(-entry.cashOutflow - exit.cashOutflow, 20);
  });

  it("does not release dividend cash without a payable date", () => {
    const rows = entitle(
      [{ symbol: "SPY", exDate: "2024-03-15", amountPerShare: 1.5 }],
      () => 10,
    );
    assert.equal(rows[0].accrued, 15);
    assert.equal(rows[0].cashAvailable, false);
    assert.equal(rows[0].reason, "PAYABLE_DATE_MISSING");
    assert.equal(entitle([{ symbol: "SPY", exDate: "2024-03-15", amountPerShare: 1.5 }], () => 0)[0].reason, "NOT_HELD_BEFORE_EX_DATE");
  });

  it("reconciles corrected BTC trades to portfolio equity", () => {
    const bars = Array.from({ length: 140 }, (_, i) => ({
      ts: 1_700_000_000 + i * 86_400,
      open: 100 + i,
      high: 101 + i,
      low: 99 + i,
      close: 100 + i,
      volume: 1,
    }));
    const report = runTrend(bars, 120, 25, 5);
    const tradeNet = report.trades.reduce((a, t) => a + t.net, 0);
    assert.equal(Math.abs(100_000 + tradeNet - (100_000 * (1 + report.netReturn))) < 0.05, true);
    assert.equal(report.trades.every((t) => t.fees > 0), true);
  });
});
