import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { load, persist, runNoTrade, runSynthetic } from "./sim.ts";

describe("simulated lifecycle", () => {
  it("completes a test-only trade to flat", () => {
    const out = runSynthetic();
    assert.equal(out.final, "FLAT");
    assert.equal(out.events[0].type, "RESEARCH");
    assert.equal(out.events.at(-1)?.type, "HERMES");
  });

  it("keeps the real-data cycle as no trade", async () => {
    const out = await runNoTrade();
    assert.equal(out.decision.action, "NO_TRADE");
  });

  it("recovers persisted state without a second order", () => {
    const root = mkdtempSync(join(tmpdir(), "apex-sim-"));
    const path = join(root, "state.json");
    persist(path, { orders: 1, final: "FLAT" });
    const loaded = load(path) as { orders: number };
    assert.equal(loaded.orders, 1);
  });
});
