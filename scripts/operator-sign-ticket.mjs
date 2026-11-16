#!/usr/bin/env node
/**
 * Operator-owned signing action. Not called by the coding agent.
 * Reads APEX_OPERATOR_SECRET from the operator environment and writes a
 * signed approval outside Git.
 * Usage: APEX_OPERATOR_SECRET=... node scripts/operator-sign-ticket.mjs research/lab/monday-spy-preflight.json
 */
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const secret = process.env.APEX_OPERATOR_SECRET;
if (!secret || secret.length < 32) {
  console.error("operator secret missing; refusing to sign");
  process.exit(1);
}
const ticketPath = process.argv[2];
if (!ticketPath) {
  console.error("usage: node scripts/operator-sign-ticket.mjs <proposed-ticket.json>");
  process.exit(1);
}
const proposed = JSON.parse(readFileSync(ticketPath, "utf8"));
if (proposed.verdict !== "READY_FOR_OPERATOR_APPROVAL") {
  console.error("ticket is not ready for approval");
  process.exit(1);
}
const approval = {
  source: "OPERATOR_SIGNED",
  clientOrderId: proposed.clientOrderId,
  symbol: proposed.symbol,
  side: proposed.side,
  qty: proposed.qty,
  limitPrice: proposed.limitPrice,
  session: proposed.session,
  expiresAt: proposed.expiresAt,
  quoteTimestamp: proposed.quote.timestamp,
};
const material = [approval.symbol, approval.side, "limit", "day", String(approval.qty), String(approval.limitPrice), approval.session, approval.clientOrderId, approval.expiresAt, approval.quoteTimestamp].join("|");
approval.proof = createHmac("sha256", secret).update(material).digest("hex");
const out = process.env.APEX_OPERATOR_APPROVAL_PATH || ".operator/spy-approval.json";
writeFileSync(out, JSON.stringify(approval, null, 2));
console.log(JSON.stringify({ signed: true, path: out, clientOrderId: approval.clientOrderId, storedInGit: false }));
void randomUUID;
