import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPaperExit } from "./paper-exit.ts";

describe("paper exit request", () => {
  it("builds a paper POST and does not send it", () => {
    const out = buildPaperExit(0.00029, false);
    assert.equal(out.sent, false);
    assert.equal(out.request.method, "POST");
    assert.equal(out.request.url, "https://paper-api.alpaca.markets/v2/orders");
    assert.equal(out.request.body.client_order_id, "mock-exit-1");
    assert.equal(out.request.body.qty, "0.00029");
  });
});
