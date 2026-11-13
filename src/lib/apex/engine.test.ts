import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runAcceptance } from "./drills.ts";

describe("apex quant x", () => {
  it("holds the research, risk, and execution invariants", () => {
    const report = runAcceptance();
    const failed = report.checks.filter((c) => !c.passed);
    assert.deepEqual(
      failed.map((c) => `${c.id}: ${c.detail}`),
      [],
    );
  });
});
