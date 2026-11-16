import assert from "node:assert/strict";
import test from "node:test";
import { ROLES } from "../../../src/lib/apex/research/canonical-decision.ts";
import { architectureReadiness } from "../../../src/lib/apex/live/architecture.ts";
import { MODE_GATE } from "../src/mode.ts";

test("executor defaults and the six-stage, 13-role research architecture stay intact", () => {
  assert.deepEqual(MODE_GATE, {
    mode: "PAPER_READ_ONLY",
    paperPost: "DISABLED",
    livePost: "DISABLED",
    autonomousStrategyTrading: "DISABLED",
    strategyApproved: false,
  });
  assert.equal(architectureReadiness().length, 6);
  assert.equal(ROLES.length, 13);
  assert.deepEqual([...ROLES], ["Scout", "Vector", "Atlas", "Oracle", "Pulse", "Volta", "Bull", "Bear", "Sigma", "Sentinel", "Allocator", "Pilot", "Hermes"]);
});
