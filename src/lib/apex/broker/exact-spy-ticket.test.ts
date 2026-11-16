import assert from "node:assert/strict";
import test from "node:test";
import { authorizationMatches, prepareExactSpyBuy } from "./exact-spy-ticket.ts";

test("exact SPY ticket is unique, regular-session, and not authorized", () => {
  const a = prepareExactSpyBuy(new Date("2026-11-15T21:27:00-05:00"));
  const b = prepareExactSpyBuy(new Date("2026-11-15T21:27:00-05:00"));
  assert.equal(a.status, "PREPARED_NOT_AUTHORIZED");
  assert.equal(a.submitted, false);
  assert.equal(a.operatorAuthorized, false);
  assert.equal(a.session, "REGULAR");
  assert.equal(a.sessionWindow, "2026-11-16 09:30-16:00 ET");
  assert.notEqual(a.clientOrderId, b.clientOrderId);
  assert.notEqual(a.clientOrderId, "apex-spy-paper-prepared");
  assert.equal(a.qty, null);
  assert.equal(a.limitPrice, null);
});

test("authorization must match symbol, side, session, expiry and the $25 cap", () => {
  const t = prepareExactSpyBuy(new Date("2026-11-15T21:27:00-05:00"));
  assert.equal(authorizationMatches({ symbol: "SPY", side: "buy", qty: 0.03, limitPrice: 750, session: "REGULAR", expiresAt: t.expiresAt }, t), true);
  assert.equal(authorizationMatches({ symbol: "QQQ", side: "buy", qty: 0.03, limitPrice: 750, session: "REGULAR", expiresAt: t.expiresAt }, t), false);
  assert.equal(authorizationMatches({ symbol: "SPY", side: "buy", qty: 1, limitPrice: 750, session: "REGULAR", expiresAt: t.expiresAt }, t), false);
});
