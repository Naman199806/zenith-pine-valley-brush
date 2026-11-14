import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discussion, independentPass } from "./protocol.ts";
import { reset, runCycle } from "./scheduler.ts";

describe("research protocol and scheduler", () => {
  it("keeps first-pass independent and only creates a discussion from real evidence", () => {
    const first = independentPass("c1");
    assert.equal(first.length, 13);
    assert.equal(first.every((m) => m.destination === "decision"), true);
    assert.equal(discussion("c1", "r1", "", "bear case").length, 0);
    assert.equal(discussion("c1", "r1", "bull case", "bear case").length, 2);
  });

  it("schedules a mocked cycle, recovers the same cycle, and stays NO_TRADE", async () => {
    reset();
    const path = join(mkdtempSync(join(tmpdir(), "apex-")), "cycles.json");
    const fetchImpl = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ stance: "DEFER", thesis: "x", broker_action: "NONE" }) } }] }), { status: 200 });
    const first = await runCycle("cycle-1", fetchImpl, path);
    const second = await runCycle("cycle-1", fetchImpl, path);
    assert.equal(first.action, "NO_TRADE");
    assert.equal(first.roles, 13);
    assert.equal(first.paid, false);
    assert.equal(first.brokerWrites, 0);
    assert.equal(second.cycleId, first.cycleId);
  });
});
