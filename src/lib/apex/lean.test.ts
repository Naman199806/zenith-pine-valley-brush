import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertEngineLabel, LEAN_EXECUTION, LEAN_PIN } from "./lean/contract.ts";
import { FIXTURE_BARS, FIXTURE_INPUT, FIXTURE_QTY, runFixtureNotLean } from "./lean/smoke.ts";

describe("lean adapter contract", () => {
  it("matches an independent next-open hand calculation and is not LEAN", () => {
    const result = runFixtureNotLean();
    const bar0 = FIXTURE_BARS[0]!;
    const bar1 = FIXTURE_BARS[1]!;
    const bar2 = FIXTURE_BARS[2]!;

    // Hand calculation. Do not call the smoke fee helper.
    const signalLong = 10_050 > 10_000;
    const entryCents = 10_080;
    const exitCents = 10_120;
    const qty = 100;
    const costBps = 10;
    const grossCents = (exitCents - entryCents) * qty;
    const entryFeeCents = (entryCents * qty * costBps) / 10_000;
    const exitFeeCents = (exitCents * qty * costBps) / 10_000;
    const netCents = grossCents - entryFeeCents - exitFeeCents;

    assert.equal(signalLong, true);
    assert.equal(bar0.close > bar0.open, true);
    assert.equal(bar1.open, entryCents);
    assert.equal(bar2.open, exitCents);
    assert.equal(qty, FIXTURE_QTY);
    assert.equal(grossCents, 4_000);
    assert.equal(entryFeeCents, 1_008);
    assert.equal(exitFeeCents, 1_012);
    assert.equal(netCents, 1_980);

    assert.equal(result.strategyId, "fixture-long-if-up");
    assert.equal(result.version, "fixture-1");
    assert.deepEqual(result.instrumentIds, ["FIXTURE"]);
    assert.equal(result.fillRule, "next bar open");
    assert.equal(result.costBps, costBps);
    assert.equal(result.tradeCount, 1);
    assert.equal(result.netPnlCents, netCents);
    assert.equal(result.ordersPlaced, 0);
    assert.equal(result.sourceOfTruth, "apex-ledger");
    assert.equal(result.engine, "fixture-not-lean");
    assert.equal(result.leanProcessRan, false);
    assert.equal(result.trades.length, 1);
    assert.equal(result.trades[0]!.fillBar, 1);
    assert.equal(result.trades[0]!.fillPriceCents, bar1.open);
    assert.equal(result.trades[0]!.exitFillBar, 2);
    assert.equal(result.trades[0]!.exitPriceCents, bar2.open);
    assert.equal(result.trades[0]!.netPnlCents, netCents);

    assert.equal(LEAN_EXECUTION.status, "SIDECAR");
    assert.equal(LEAN_EXECUTION.ran, false);
    assert.equal(LEAN_EXECUTION.reason, "typescript-module-does-not-spawn-lean");
    assert.equal(LEAN_PIN.sha, "655ac6d475ad8539ff54583a26327e63b59c5703");
    assert.equal(LEAN_PIN.license, "Apache-2.0");
  });

  it("stays flat when bar 0 does not close above its open", () => {
    const bars = FIXTURE_BARS.map((bar, index) => (index === 0 ? { ...bar, close: 9_990 } : { ...bar }));
    const result = runFixtureNotLean({ ...FIXTURE_INPUT, bars });
    assert.equal(result.tradeCount, 0);
    assert.equal(result.netPnlCents, 0);
    assert.equal(result.engine, "fixture-not-lean");
  });

  it("refuses engine lean without a process", () => {
    const result = runFixtureNotLean();
    assert.throws(
      () => assertEngineLabel({ ...result, engine: "lean", leanProcessRan: false }),
      /refusing engine "lean" without a LEAN process/,
    );
    assert.throws(
      () => assertEngineLabel({ engine: "lean", leanProcessRan: true, processPid: 0 }),
      /refusing engine "lean" without a LEAN process/,
    );
    assert.throws(
      () => assertEngineLabel({ engine: "lean", leanProcessRan: true, processPid: 4242 }),
      /LEAN pin mismatch/,
    );
    assert.doesNotThrow(() =>
      assertEngineLabel({
        engine: "lean",
        leanProcessRan: true,
        processPid: 4242,
        pinSha: LEAN_PIN.sha,
        brokerOrders: false,
      }),
    );
  });

  it("refuses an order-placing request", () => {
    assert.throws(
      () => runFixtureNotLean({ ...FIXTURE_INPUT, placeOrders: true as false }),
      /must not place orders/,
    );
  });
});
