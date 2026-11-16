import assert from "node:assert/strict";
import test from "node:test";
import { PAPER_POST_ENABLED, LIVE_POST_ENABLED, POST_ENABLED, STRATEGY_APPROVED, assertNoLiveCreds, nextPollDelay } from "../../../../services/apex-executor/src/runtime.ts";
import { ROLES } from "./canonical-decision.ts";
import { architectureReadiness } from "../live/architecture.ts";

test("execution flags stay fail-closed", () => {
  assert.equal(PAPER_POST_ENABLED, false);
  assert.equal(LIVE_POST_ENABLED, false);
  assert.equal(POST_ENABLED, false);
  assert.equal(STRATEGY_APPROVED, false);
  assert.throws(() => assertNoLiveCreds({ APEX_EXECUTOR_MODE: "PAPER", APCA_LIVE_API_KEY_ID: "AK" }), /LIVE credentials/);
});

test("poll backoff does not tighten below the accepted baseline", () => {
  assert.ok(nextPollDelay(3000, false) >= 3000);
  assert.ok(nextPollDelay(3000, true) >= 3000);
});

test("six stages and 13 research roles remain", () => {
  assert.equal(architectureReadiness().length, 6);
  assert.equal(ROLES.length, 13);
});
