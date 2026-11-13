import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { acceptResult, issueToken } from "./ingest.ts";

const base = {
  schema_version: "apex-bot-research-v1",
  run_id: "run-1",
  agent_id: "Vector",
  symbol: "BTC/USD",
  as_of_utc: "2026-11-12T00:00:00Z",
  stance: "DEFER",
  thesis: "test thesis",
  broker_action: "NONE",
  observations: [{ close: 71369.9 }],
};

describe("bot result ingest", () => {
  it("accepts a valid research result once", () => {
    const root = mkdtempSync(join(tmpdir(), "apex-ingest-"));
    const token = issueToken(base.run_id, base.agent_id);
    assert.equal(acceptResult(base, token, root).ok, true);
    assert.equal(acceptResult(base, token, root).ok, false);
  });

  it("rejects descriptive support and missing as-of", () => {
    const root = mkdtempSync(join(tmpdir(), "apex-ingest-"));
    const token = issueToken("run-2", "Vector");
    const bad = { ...base, run_id: "run-2", stance: "SUPPORT", thesis: null };
    assert.equal(acceptResult(bad, token, root).reason, "descriptive_support");
    const token2 = issueToken("run-3", "Vector");
    assert.equal(acceptResult({ ...base, run_id: "run-3", as_of_utc: null }, token2, root).reason, "missing_as_of");
  });

  it("rejects unauthenticated and broker actions", () => {
    const root = mkdtempSync(join(tmpdir(), "apex-ingest-"));
    assert.equal(acceptResult(base, "nope", root).reason, "bad_token");
    const token = issueToken(base.run_id, base.agent_id);
    assert.equal(acceptResult({ ...base, broker_action: "BUY" }, token, root).reason, "broker_action");
  });

  it("binds a result to one of the 13 registered bots", () => {
    const root = mkdtempSync(join(tmpdir(), "apex-ingest-"));
    const ids = ["scout","vector","atlas","oracle","pulse","volta","bull","bear","sigma","sentinel","allocator","pilot","hermes"];
    for (const id of ids) {
      const token = issueToken(`run-${id}`, id);
      assert.equal(acceptResult({ ...base, run_id: `run-${id}`, agent_id: id }, token, root).ok, true);
    }
    const foreign = issueToken("run-x", "scout");
    assert.equal(acceptResult({ ...base, run_id: "run-x", agent_id: "hermes" }, foreign, root).reason, "bad_token");
  });

  it("rejects a token issued to another bot", () => {
    const root = mkdtempSync(join(tmpdir(), "apex-ingest-"));
    const token = issueToken("run-4", "Bear");
    assert.equal(acceptResult({ ...base, run_id: "run-4", agent_id: "Vector" }, token, root).reason, "bad_token");
  });
});
