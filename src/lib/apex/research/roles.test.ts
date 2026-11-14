import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { btcPacket } from "../bots/packet.ts";
import { cycle, ROLES, runRole, type ModelClient } from "./roles.ts";

const mock: ModelClient = {
  async complete() {
    return { text: JSON.stringify({ stance: "DEFER" }), tokens: 1 };
  },
};

describe("13 role dry run", () => {
  it("runs all roles without a paid call and returns no trade", async () => {
    const out = await cycle(btcPacket(), mock, { quantOk: true, riskOk: true, strategyApproved: false });
    assert.equal(out.roles.length, ROLES.length);
    assert.equal(out.decision.action, "NO_TRADE");
    assert.equal(out.paidCalls, 0);
    assert.equal(out.brokerWrites, 0);
  });

  it("marks equity-only roles unavailable for BTC", async () => {
    const atlas = await runRole("atlas", btcPacket(), mock);
    assert.equal(atlas.stance, "UNAVAILABLE");
  });
});
