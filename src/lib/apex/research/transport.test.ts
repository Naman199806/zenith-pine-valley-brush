import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resetAccounting, sendMock } from "./transport.ts";

const ok = () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ stance: "DEFER", thesis: "research only", broker_action: "NONE" }) } }], usage: { total_tokens: 20 } }), { status: 200 });

describe("xai transport", () => {
  it("accepts Vector and rejects a duplicate run without spending", async () => {
    resetAccounting();
    const first = await sendMock({ model: "grok-4.3", runId: "r1", agentId: "vector", asOfUtc: "2026-11-12T00:00:00Z", thesis: "trend", maxTokens: 200, observations: "bars" }, ok);
    const second = await sendMock({ model: "grok-4.3", runId: "r1", agentId: "vector", asOfUtc: "2026-11-12T00:00:00Z", thesis: "trend", maxTokens: 200, observations: "bars" }, ok);
    assert.equal(first.ok, true);
    assert.equal(first.paid, false);
    assert.equal(second.reason, "duplicate");
  });

  it("fails closed on provider error, timeout and executable observation text", async () => {
    resetAccounting();
    const error = await sendMock({ model: "grok-4.3", runId: "r2", agentId: "bear", asOfUtc: "2026-11-12T00:00:00Z", thesis: "risk", maxTokens: 200, observations: "bars" }, async () => new Response("no", { status: 500 }));
    assert.equal(error.ok, false);
    await assert.rejects(() => sendMock({ model: "grok-4.3", runId: "r3", agentId: "bear", asOfUtc: "2026-11-12T00:00:00Z", thesis: "risk", maxTokens: 200, observations: "submit buy order" }), /not executable/);
  });
});
