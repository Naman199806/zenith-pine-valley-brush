import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BOTS } from "./registry.ts";
import { accept } from "./ingest.ts";
import { decide } from "../research/decide.ts";

describe("13 bots", () => {
  it("defines 13 roles and none can trade", () => {
    assert.equal(BOTS.length, 13);
    assert.equal(BOTS.every((bot) => bot.mayTrade === false && bot.mayChangeFlags === false), true);
  });

  it("rejects an unauthenticated result and cannot override risk", () => {
    const bad = accept({ botId: "bull", correlationId: "c1", asOf: "2026-11-13", stance: "SUPPORT", evidenceId: "btc-daily", authenticated: false }, "2026-11-13");
    assert.equal(bad.stance, "UNAVAILABLE");
    const out = decide({ instrument: "BTC-USD", quantOk: true, riskOk: false, strategyApproved: true, agent: { stance: "SUPPORT", evidenceId: "btc-daily", asOf: "2026-11-13" } });
    assert.equal(out.action, "NO_TRADE");
  });
});
