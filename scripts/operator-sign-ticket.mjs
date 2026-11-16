#!/usr/bin/env node
/**
 * Operator-owned signing action. Not called by the coding agent.
 * PowerShell 5.1:
 *   $env:APEX_OPERATOR_SECRET = "<set locally>"
 *   node scripts/operator-sign-ticket.mjs research/lab/monday-spy-preflight.json
 * The secret is read only from the environment. It is never logged or passed as an argument.
 */
import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

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
};
const material = [approval.symbol, approval.side, "limit", "day", String(approval.qty), String(approval.limitPrice), approval.session, approval.clientOrderId, approval.expiresAt].join("|");
approval.proof = createHmac("sha256", secret).update(material).digest("hex");
const out = process.env.APEX_OPERATOR_APPROVAL_PATH || ".operator/spy-approval.json";
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(approval, null, 2));
console.log(JSON.stringify({ signed: true, path: out, clientOrderId: approval.clientOrderId, storedInGit: false }));
