import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { btcPacket } from "../bots/packet.ts";
import { buildPrompt, estimateCycleCost, runAgent, validate, type ModelClient, type ResearchRequest, type ResearchResult } from "./xai-adapter.ts";

function mock(stance: ResearchResult["stance"]): ModelClient {
  return {
    async complete() {
      const result: ResearchResult = {
        schema_version: "apex-bot-research-v1",
        provenance: "XAI_API",
        run_id: "ignored",
        agent_id: "Vector",
        symbol: "BTC/USD",
        as_of_utc: "2026-11-12T00:00:00Z",
        stance,
        thesis: "price fell",
        broker_action: "NONE",
        observations: [{ claim: "completed bar present", source: "coinbase-public" }],
      };
      return { text: JSON.stringify(result), tokens: 10 };
    },
  };
}

const request = (agentId: "Vector" | "Bear", runId: string): ResearchRequest => ({
  runId,
  agentId,
  symbol: "BTC/USD",
  asOfUtc: "2026-11-12T00:00:00Z",
  thesis: "price fell",
  input: btcPacket(),
  horizon: "1D",
});

describe("xai research adapter", () => {
  it("runs Vector and Bear independently from mocks", async () => {
    const vector = await runAgent(request("Vector", "v1"), mock("SUPPORT"));
    const bear = await runAgent(request("Bear", "b1"), mock("REJECT"));
    assert.equal(vector.provenance, "XAI_API");
    assert.equal(bear.provenance, "XAI_API");
    assert.equal(vector.stance, "SUPPORT");
    assert.equal(bear.stance, "REJECT");
    assert.equal(validate(vector).ok, true);
    assert.equal(validate(vector).reason, "replay");
  });

  it("returns unavailable when no completed bars exist", async () => {
    const empty = request("Vector", "v-empty");
    empty.input = { ...btcPacket(), bars: [] };
    const result = await runAgent(empty, mock("SUPPORT"));
    assert.equal(result.stance, "UNAVAILABLE");
  });

  it("loads role instructions and estimates cost without a live call", () => {
    const prompt = buildPrompt(request("Bear", "b2"));
    assert.equal(prompt.includes("Bear"), true);
    assert.equal(estimateCycleCost().usd > 0, true);
  });
});
