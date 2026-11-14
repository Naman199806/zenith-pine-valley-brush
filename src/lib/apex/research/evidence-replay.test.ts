import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadReplay } from "./evidence-replay.ts";
import { decide } from "./decide.ts";

describe("real evidence replay", () => {
  const report = loadReplay(process.cwd(), "2026-11-14T00:10:00Z");

  it("replays real Vector and Bear evidence and excludes the rejected claim", () => {
    assert.equal(report.accepted.every((item) => item.provenance === "XAI_API"), true);
    assert.equal(report.accepted.some((item) => item.agent === "vector"), true);
    assert.equal(report.accepted.some((item) => item.agent === "bear"), true);
    assert.equal(report.rejected.length, 1);
    assert.equal(report.rejected[0].text.includes("successive lower closes"), true);
    assert.equal(report.accepted.some((item) => item.text.includes("successive lower closes")), false);
  });

  it("keeps historical research out of current analysis and does not invent Bull", () => {
    assert.equal(report.accepted.every((item) => item.historical && item.current === false), true);
    assert.equal(report.unavailable.some((item) => item.agent === "bull" && item.status === "PROVIDER_BILLING_BLOCKED"), true);
    assert.equal(report.accepted.some((item) => item.agent === "bull"), false);
  });

  it("returns NO_TRADE with the billing lock active and zero writes", () => {
    assert.equal(report.decision.action, "NO_TRADE");
    assert.equal(report.decision.reason, "No approved strategy.");
    assert.equal(report.billingLocked, true);
    assert.equal(report.paidCalls, 0);
    assert.equal(report.brokerWrites, 0);
  });

  it("cannot let AI agreement override Quant or Risk", () => {
    const agreed = decide({ instrument: "BTC/USD", quantOk: false, riskOk: true, strategyApproved: true, agent: { stance: "SUPPORT", evidenceId: "x", asOf: "2026-11-12T23:59:59Z" } });
    const risk = decide({ instrument: "BTC/USD", quantOk: true, riskOk: false, strategyApproved: true, agent: { stance: "SUPPORT", evidenceId: "x", asOf: "2026-11-12T23:59:59Z" } });
    const noStrategy = decide({ instrument: "BTC/USD", quantOk: true, riskOk: true, strategyApproved: false, agent: { stance: "SUPPORT", evidenceId: "x", asOf: "2026-11-12T23:59:59Z" } });
    assert.equal(agreed.action, "NO_TRADE");
    assert.equal(agreed.quantRejects, true);
    assert.equal(risk.action, "NO_TRADE");
    assert.equal(risk.riskRejects, true);
    assert.equal(noStrategy.action, "NO_TRADE");
  });
});
