import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runUnifiedWorkflow } from "./workflow.ts";
import { assessProposal, paperAutoEligible } from "./gate.ts";
import { SCHEMA_VERSION } from "./contracts.ts";
import { setEvidenceRoot } from "./evidence-root.ts";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("unified workflow adapters", () => {
  it("invokes every available adapter and refuses an order", () => {
    const empty = mkdtempSync(join(tmpdir(), "apex-empty-"));
    setEvidenceRoot(empty);
    const missing = runUnifiedWorkflow();
    assert.equal(missing.adapters.lean, "missing");
    setEvidenceRoot(null);
    const fixture = mkdtempSync(join(tmpdir(), "apex-lean-"));
    mkdirSync(join(fixture, ".runtimes/lean-run"), { recursive: true });
    writeFileSync(join(fixture, ".runtimes/lean-run/apex-lean-summary.json"), JSON.stringify({ engine: "lean", pin: "fixture", netProfit: 0 }));
    setEvidenceRoot(fixture);
    try {
      const result = runUnifiedWorkflow();
      assert.equal(result.executable, false);
      assert.equal(result.paperAutoEligible, false);
      assert.equal(result.liveEnabled, false);
      assert.equal(result.hermesCanApprove, false);
      assert.equal(result.alpacaIsSoleBroker, true);
      assert.equal(result.proposalAccepted, false);
      assert.equal(result.adapters.lean, "invoked");
    } finally {
      setEvidenceRoot(null);
    }
  });

  it("a hypothesis proposal is not paper-auto eligible", () => {
    const proposal = {
      schemaVersion: SCHEMA_VERSION,
      id: "x",
      originFramework: "tradingagents" as const,
      strategyId: "s",
      strategyVersion: "1",
      instrument: { schemaVersion: SCHEMA_VERSION, symbol: "SPY", venue: "research" },
      direction: "flat" as const,
      ts: new Date().toISOString(),
      sourceDataTs: new Date().toISOString(),
      entryAssumption: "none",
      holdingPeriod: "n/a",
      exitCondition: "n/a",
      estimatedCostBps: 1,
      provenance: "test",
      validationStatus: "hypothesis" as const,
      evidenceIds: ["e"],
      executable: false as const,
    };
    assert.equal(assessProposal(proposal).accepted, false);
    assert.equal(paperAutoEligible(proposal), false);
  });
});
