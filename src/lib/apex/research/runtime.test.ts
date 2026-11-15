import assert from "node:assert/strict";
import test from "node:test";
import { planPaperOrder } from "../broker/paper-pipeline.ts";
import { parseRss } from "./public-feeds.ts";

test("disabled runtime cannot submit and expired auth is not reused", () => {
  const plan = planPaperOrder({ signal: "BUY", price: 100, cash: 1000, maxNotional: 25, strategyApproved: false, riskOk: true, billingLocked: true, authorizationExpiresAt: null, nowMs: Date.now(), ownedQty: 0, endpoint: "https://paper-api.alpaca.markets/v2/orders" });
  assert.equal(plan.action, "NO_TRADE");
  assert.equal(plan.brokerWrites, 0);
});

test("billing lock does not block a risk-reducing exit plan", () => {
  const plan = planPaperOrder({ signal: "EXIT", price: 100, cash: 1000, maxNotional: 25, strategyApproved: false, riskOk: false, billingLocked: true, authorizationExpiresAt: null, nowMs: Date.now(), ownedQty: 0.001, endpoint: "https://paper-api.alpaca.markets/v2/orders" });
  assert.equal(plan.action, "DRY_RUN_EXIT");
});

test("public RSS parser extracts titles", () => {
  const items = parseRss("<rss><channel><item><title>Rate decision</title><pubDate>Sun, 15 Nov 2026</pubDate><link>https://example.test</link></item></channel></rss>");
  assert.equal(items[0].title, "Rate decision");
});
