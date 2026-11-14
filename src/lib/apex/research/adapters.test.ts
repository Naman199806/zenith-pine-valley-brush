import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { discussion, independentPass } from "./protocol.ts";
import { bearPacket, mockAll, readyCount } from "./adapters.ts";
import { resetAccounting } from "./transport.ts";

describe("multi-agent readiness", () => {
  it("has 13 role instructions and a frozen Bear packet", () => {
    assert.equal(readyCount(), 13);
    const bear = bearPacket();
    assert.equal(bear.agentId, "bear");
    assert.equal(bear.maxTokens, 1600);
    assert.equal(bear.asOfUtc, "2026-11-12T23:59:59Z");
  });

  it("keeps first-pass independent and only discusses with both sides present", async () => {
    resetAccounting();
    const first = independentPass("cycle-mock");
    assert.equal(first.every((m) => m.destination === "decision"), true);
    assert.equal(discussion("cycle-mock", "r1", "", "bear").length, 0);
    const messages = discussion("cycle-mock", "r1", "bull evidence", "bear evidence");
    assert.equal(messages.every((m) => m.cycleId && m.runId && m.source && m.destination && m.timestamp), true);
    const fetchImpl = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ stance: "DEFER", thesis: "x", broker_action: "NONE" }) } }] }), { status: 200 });
    const results = await mockAll(fetchImpl);
    assert.equal(results.length, 13);
    assert.equal(results.every((r) => r.paid === false), true);
  });
});
