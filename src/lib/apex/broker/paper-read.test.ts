import assert from "node:assert/strict";
import test from "node:test";
import { assertPaperCreds } from "./paper-read.ts";
import { prepareEquityPaperTicket } from "./paper-verify.ts";

test("PAPER reader rejects LIVE host and non-PK keys", () => {
  assert.equal(assertPaperCreds({ keyId: "AKLIVEKEY", secret: "x" }, "https://api.alpaca.markets"), "LIVE host rejected");
  assert.equal(assertPaperCreds({ keyId: "AKLIVEKEY", secret: "x" }), "LIVE or non-paper key rejected");
  assert.equal(assertPaperCreds({ keyId: "PKPAPERKEY", secret: "" }), "missing paper secret");
  assert.equal(assertPaperCreds({ keyId: "PKPAPERKEY", secret: "present" }), null);
});

test("ETF PAPER ticket remains prepared and not authorized", () => {
  const t = prepareEquityPaperTicket();
  assert.equal(t.status, "PREPARED_NOT_AUTHORIZED");
  assert.equal(t.submitted, false);
  assert.equal(t.executionAuthorized, false);
});
