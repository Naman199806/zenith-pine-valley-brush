import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RESEARCH_STATUS, statusOf } from "./research-status.ts";

describe("research status contract", () => {
  it("records real completed research for Vector and Bear only", () => {
    const vector = statusOf("vector");
    const bear = statusOf("bear");
    assert.equal(vector?.phase, "ACCEPTED_WITH_CORRECTION");
    assert.equal(vector?.researchCompleted, true);
    assert.equal(vector?.corrected, true);
    assert.equal(vector?.rejectedClaim, true);
    assert.equal(bear?.phase, "ACCEPTED");
    assert.equal(bear?.researchCompleted, true);
    assert.equal(bear?.accepted, true);
  });

  it("records Bull as one attempted 402 with no completed research", () => {
    const bull = statusOf("bull");
    assert.equal(bull?.phase, "PROVIDER_BILLING_BLOCKED");
    assert.equal(bull?.requestAttempted, true);
    assert.equal(bull?.responseReceived, true);
    assert.equal(bull?.researchCompleted, false);
    assert.equal(bull?.accepted, false);
    assert.equal(bull?.liveTested, false);
  });

  it("keeps the other ten roles not live-tested", () => {
    const rest = RESEARCH_STATUS.filter((row) => !["vector", "bear", "bull"].includes(row.id));
    assert.equal(rest.length, 10);
    assert.equal(rest.every((row) => row.phase === "NOT_LIVE_TESTED" && row.liveTested === false && row.requestAttempted === false), true);
  });
});
