import assert from "node:assert/strict";
import test from "node:test";
import { authorizationMatches, entitledToDividend, loadVerifiedCalendar, nextRegularSession, prepareExactSpyBuy, type Authorization, type ExactSpyTicket } from "./exact-spy-ticket.ts";

const cal = loadVerifiedCalendar();

test("calendar selects Monday after Sunday evening and skips Thanksgiving", () => {
  assert.equal(nextRegularSession(new Date("2026-11-15T21:30:00-05:00"), cal).date, "2026-11-16");
  assert.equal(nextRegularSession(new Date("2026-11-16T16:01:00-05:00"), cal).date, "2026-11-17");
  assert.equal(nextRegularSession(new Date("2026-11-20T16:01:00-05:00"), cal).date, "2026-11-23");
  assert.equal(nextRegularSession(new Date("2026-11-25T16:01:00-05:00"), cal).date, "2026-11-27");
  assert.equal(nextRegularSession(new Date("2026-11-25T16:01:00-05:00"), cal).close, "13:00");
});

test("DST offsets differ before and after the March transition", () => {
  const before = nextRegularSession(new Date("2026-03-06T16:01:00-05:00"), cal);
  const after = nextRegularSession(new Date("2026-03-06T21:01:00-05:00"), cal);
  assert.equal(before.date, "2026-03-09");
  assert.ok(before.expiresAt.endsWith("-04:00") || after.expiresAt.endsWith("-04:00"));
  assert.equal(nextRegularSession(new Date("2026-03-05T16:01:00-05:00"), cal).expiresAt.endsWith("-05:00"), true);
});

test("authorization must match the finalized ticket exactly", () => {
  const ticket = prepareExactSpyBuy(new Date("2026-11-15T21:30:00-05:00"), cal, "apex-spy-test");
  const finalized: ExactSpyTicket = { ...ticket, qty: 0.03, limitPrice: 750 };
  const auth: Authorization = { symbol: "SPY", side: "buy", orderType: "limit", timeInForce: "day", qty: 0.03, limitPrice: 750, clientOrderId: "apex-spy-test", session: "REGULAR", expiresAt: ticket.expiresAt };
  assert.equal(authorizationMatches(auth, ticket), false);
  assert.equal(authorizationMatches(auth, finalized), true);
  assert.equal(authorizationMatches({ ...auth, clientOrderId: "other" }, finalized), false);
  assert.equal(authorizationMatches({ ...auth, qty: 1, limitPrice: 750 }, { ...finalized, qty: 1, limitPrice: 750 }), false);
});

test("next-open entry is not entitled to that morning's dividend", () => {
  assert.equal(entitledToDividend("2026-11-17", "2026-11-17"), false);
  assert.equal(entitledToDividend("2026-11-16", "2026-11-17"), true);
});
