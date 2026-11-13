import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runPaperSafety } from "../broker/safety.ts";
import { leanFixtureDollars, smaReferenceCents } from "./reference.ts";
import { assessProposal, paperAutoEligible } from "./gate.ts";
import { disabledInvocation, integrationHealth, researchContribution, sampleHypothesis, setAdapterEnabled, staleEvidenceRejected } from "./registry.server.ts";
import { setEvidenceRoot } from "./evidence-root.ts";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("framework integration", () => {
  it("rejects a scanner hypothesis and keeps human approval out of paper-auto", () => {
    const proposal = sampleHypothesis();
    const decision = assessProposal(proposal);
    assert.equal(decision.accepted, false);
    assert.match(decision.reasons.join(" "), /hypothesis/);
    assert.equal(paperAutoEligible(proposal), false);
    assert.equal(proposal.executable, false);
    const approved = { ...proposal, validationStatus: "human-approved" as const };
    assert.equal(assessProposal(approved).accepted, true);
    assert.equal(paperAutoEligible(approved), false);
    const forged = { ...proposal, executable: true as false };
    assert.equal(assessProposal(forged).accepted, false);
  });

  it("rejects stale evidence and still passes the paper risk checks", () => {
    assert.ok(staleEvidenceRejected().length >= 2);
    assert.equal(runPaperSafety().passed, true);
  });

  it("matches the independent SMA and LEAN fixture identities", () => {
    assert.equal(smaReferenceCents().netCents, -3021);
    assert.equal(leanFixtureDollars().net, 50);
  });

  it("reads evidence-backed statuses and never marks a research engine ACTIVE", () => {
    const health = integrationHealth();
    const byId = Object.fromEntries(health.map((row) => [row.id, row]));
    for (const id of ["lean", "tradingagents", "hermes", "freqtrade", "backtrader", "day-trader-skill"] as const) {
      assert.notEqual(byId[id]?.status, "ACTIVE");
      assert.notEqual(byId[id]?.status, "NOT_INSTALLED");
    }
    assert.equal(byId.backtrader?.status, "INTEGRATED");
    assert.equal(byId.freqtrade?.status, "INTEGRATED");
    assert.equal(byId.lean?.status, "INTEGRATED");
    assert.equal(byId.tradingagents?.status, "INTEGRATED");
    assert.equal(byId.hermes?.status, "INTEGRATED");
    assert.equal(byId["day-trader-skill"]?.status, "INTEGRATED");
    assert.match(byId.backtrader?.lastTest ?? "", /19\.80/);
    assert.match(byId.backtrader?.lastTest ?? "", /-30\.21/);
    assert.match(byId.lean?.boundary ?? "", /not the Apex next-bar-open/);
    const empty = mkdtempSync(join(tmpdir(), "apex-empty-"));
    setEvidenceRoot(empty);
    const absent = researchContribution();
    assert.equal(absent.riskVerdict, null);
    setEvidenceRoot(null);
    const fixture = mkdtempSync(join(tmpdir(), "apex-evidence-"));
    mkdirSync(join(fixture, ".runtimes/day-trader-run"), { recursive: true });
    writeFileSync(join(fixture, ".runtimes/day-trader-run/risk.json"), JSON.stringify({ results: [{ verdict: "BLOCK", reasons: ["fixture"] }] }));
    writeFileSync(join(fixture, ".runtimes/day-trader-run/workflow.json"), JSON.stringify({ brokerInvoked: false }));
    setEvidenceRoot(fixture);
    try {
      const desk = researchContribution();
      assert.equal(desk.paperAuto, false);
      assert.equal(desk.brokerInvoked, false);
      assert.equal(desk.riskVerdict, "BLOCK");
    } finally {
      setEvidenceRoot(null);
    }
  });

  it("does not invoke a disabled adapter", () => {
    setAdapterEnabled("backtrader", false);
    try {
      const refused = disabledInvocation("backtrader");
      assert.match(refused?.text ?? "", /disabled/);
      const health = integrationHealth().find((row) => row.id === "backtrader");
      assert.equal(health?.status, "BLOCKED");
      assert.match(health?.errors.join(" ") ?? "", /not invoked/);
    } finally {
      setAdapterEnabled("backtrader", true);
    }
  });
});
