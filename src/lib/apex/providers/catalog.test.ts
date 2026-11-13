import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { failClosed, PROVIDERS } from "./catalog.ts";

describe("provider catalog", () => {
  it("keeps unpaid sources closed", () => {
    assert.equal(failClosed("sec-edgar").status, "UNAVAILABLE");
    assert.equal(failClosed("fred").status, "UNAVAILABLE");
    assert.equal(failClosed("reddit").status, "DENIED");
    assert.equal(failClosed("x").status, "DENIED");
    assert.equal(PROVIDERS.find((row) => row.id === "yahoo")?.status, "OK");
  });
});
