import assert from "node:assert/strict";
import test from "node:test";
import { prepareSpyPaperBuy, validateSpyPaperTicket, type SpyPaperTicket } from "./spy-paper-ticket.ts";
import { HermesJournal, MockBroker } from "../live/journal.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ticket = (over: Partial<SpyPaperTicket> = {}): SpyPaperTicket => ({ ...prepareSpyPaperBuy(), operatorAuthorized: true, ...over });

test("prepared SPY buy is not authorized and exceeds nothing until authorized", () => {
  const t = prepareSpyPaperBuy();
  assert.equal(validateSpyPaperTicket(t), "operator authorization required");
  assert.ok(t.qty * t.limitPrice <= 25);
});

test("fractional gtc, market, and oversized buy are rejected", () => {
  assert.ok(validateSpyPaperTicket(ticket({ timeInForce: "gtc" as "day" })));
  assert.ok(validateSpyPaperTicket(ticket({ orderType: "market" as "limit" })));
  assert.ok(validateSpyPaperTicket(ticket({ qty: 1, limitPrice: 750 }))?.includes("25"));
});

test("mock lifecycle: partial fill, independent sell, restart, flat", () => {
  const dir = mkdtempSync(join(tmpdir(), "spy-"));
  const path = join(dir, "j.json");
  const journal = new HermesJournal(path);
  const broker = new MockBroker();
  const buy = ticket({ clientOrderId: "spy-buy-1" });
  journal.persist({ clientOrderId: buy.clientOrderId, ticket: { category: "CONNECTIVITY_TEST", symbol: "SPY", side: "buy", orderType: "market", maxNotional: 25, expiry: "2099-01-01", singleUseId: "spy-buy-1", readAuthorized: true, orderAuthorized: true, confirmed: true }, createdAt: new Date().toISOString(), status: "PERSISTED", filledQty: 0, avgPrice: null });
  broker.submit(buy.clientOrderId, "buy", buy.qty, "SPY");
  broker.partialFill(buy.clientOrderId, buy.qty / 2);
  assert.equal(broker.getPosition(), buy.qty / 2);
  broker.complete(buy.clientOrderId);
  const restarted = new HermesJournal(path);
  assert.ok(restarted.get(buy.clientOrderId));
  const sell = ticket({ side: "sell", clientOrderId: "spy-sell-1", exitAuthorizationId: "exit-auth-1" });
  assert.equal(validateSpyPaperTicket(sell), null);
  broker.submit(sell.clientOrderId, "sell", buy.qty, "SPY");
  assert.equal(broker.getPosition(), 0);
  assert.equal(broker.openOrders(), 0);
  rmSync(dir, { recursive: true, force: true });
});

test("duplicate client id and missing exit auth are blocked", () => {
  assert.ok(validateSpyPaperTicket(ticket({ side: "sell", exitAuthorizationId: null })));
  const dir = mkdtempSync(join(tmpdir(), "spy-"));
  const broker = new MockBroker();
  broker.submit("dup", "buy", 0.01, "SPY");
  const again = broker.submit("dup", "buy", 0.01, "SPY");
  assert.equal(again.clientOrderId, "dup");
  assert.equal(broker.getPosition(), 0.01);
  rmSync(dir, { recursive: true, force: true });
});
