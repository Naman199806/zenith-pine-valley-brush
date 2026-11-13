import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decide } from "./decide.ts";

describe("agent review", () => {
  const base = { instrument: "BTC-USD", quantOk: true, riskOk: true, strategyApproved: true };

  it("lets a supporting agent change an eligible fixture to HOLD", () => {
    const off = decide({ ...base, agent: { stance: "UNAVAILABLE", evidenceId: null, asOf: null } });
    const on = decide({ ...base, agent: { stance: "SUPPORT", evidenceId: "btc-daily-20261112", asOf: "2026-11-12" } });
    assert.equal(off.action, "NO_TRADE");
    assert.equal(on.action, "HOLD");
    assert.equal(on.agentChanged, true);
  });

  it("cannot override quant, risk, or missing approval", () => {
    const agent = { stance: "SUPPORT" as const, evidenceId: "x", asOf: "2026-11-12" };
    assert.equal(decide({ ...base, quantOk: false, agent }).action, "NO_TRADE");
    assert.equal(decide({ ...base, riskOk: false, agent }).action, "NO_TRADE");
    assert.equal(decide({ ...base, strategyApproved: false, agent }).action, "NO_TRADE");
  });
});
