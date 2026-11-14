import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { breakEven, runFastBenchmark } from "./fast-sim.ts";

describe("synthetic fast research", () => {
  it("processes 1000 simulated round trips without broker access", () => {
    const run = runFastBenchmark(1000);
    assert.equal(run.label, "SYNTHETIC PERFORMANCE TEST");
    assert.equal(run.eventsProcessed > 1000, true);
    assert.equal(run.fills <= run.ordersSubmitted, true);
    assert.equal(run.completedRoundTrips <= 1000, true);
    assert.equal(run.wallClockMs < 1000, true);
    assert.equal(run.feesPaid > 0, true);
  });

  it("reports instrument break-even from single-count costs", () => {
    assert.equal(breakEven({ commissionBps: 25, slippageBps: 5 }).roundTripBps, 60);
    assert.equal(breakEven({ commissionBps: 5, slippageBps: 1 }).roundTripBps, 12);
    assert.equal(breakEven({ commissionBps: 0, slippageBps: 0 }).dollars, 0);
  });
});
