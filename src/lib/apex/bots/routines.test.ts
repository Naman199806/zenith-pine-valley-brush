import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { credentialFor, routineStatus } from "./routines.ts";

describe("bot routines", () => {
  it("reports each role independently without exposing values", () => {
    const env = { VECTOR_ROUTINE_URL: "https://example.test/v", VECTOR_ROUTINE_KEY: "secret" };
    const status = routineStatus(env);
    assert.equal(status.length, 13);
    assert.equal(status.find((s) => s.id === "vector")?.configured, true);
    assert.equal(status.find((s) => s.id === "bear")?.configured, false);
    assert.equal(JSON.stringify(status).includes("secret"), false);
  });

  it("does not return another bot's credential", () => {
    const env = { BEAR_ROUTINE_URL: "https://example.test/b", BEAR_ROUTINE_KEY: "bear" };
    assert.equal(credentialFor("vector", env), null);
    assert.equal(credentialFor("bear", env)?.key, "bear");
  });
});
