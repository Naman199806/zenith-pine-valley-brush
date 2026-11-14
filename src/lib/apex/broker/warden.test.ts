import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildReconciliationEvent, postWarden } from "./warden.ts";

describe("warden webhook", () => {
  it("builds a non-secret reconciliation event", () => {
    const event = buildReconciliationEvent({ account: "masked", positions: 0 });
    assert.equal(event.event_type, "ACCOUNT_RECONCILIATION_REQUEST");
    assert.equal(JSON.stringify(event).includes("APCA"), false);
    assert.equal(JSON.stringify(event).includes("secret"), false);
  });

  it("rejects a duplicate event id without a second request", async () => {
    const event = buildReconciliationEvent({});
    const first = await postWarden("https://127.0.0.1:9", "test", event, 50);
    const second = await postWarden("https://127.0.0.1:9", "test", event, 50);
    assert.equal(second.error, "duplicate event_id");
    assert.equal(first.processed, false);
  });
});
