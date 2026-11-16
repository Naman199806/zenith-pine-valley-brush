#!/usr/bin/env node
/**
 * Operator-owned signing action. Not called by the executor.
 * Refuses an incomplete ticket. Does not fill in nonce, category, or authorization fields.
 *
 *   node --experimental-strip-types scripts/operator-sign-ticket.mjs research/lab/monday-spy-preflight.json
 *
 * The secret is read only from the environment. It is never logged or passed as an argument.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { proposedTicket, signApproval } from "../services/apex-executor/src/approval.ts";

const secret = process.env.APEX_OPERATOR_SECRET;
if (!secret || secret.length < 32) {
  console.error("operator secret missing; refusing to sign");
  process.exit(1);
}
const ticketPath = process.argv[2];
if (!ticketPath) {
  console.error("usage: node --experimental-strip-types scripts/operator-sign-ticket.mjs <proposed-ticket.json>");
  process.exit(1);
}
const proposed = JSON.parse(readFileSync(ticketPath, "utf8"));
const built = proposedTicket(proposed);
if (!built.ok) {
  console.error(built.reason);
  process.exit(1);
}
const proof = signApproval(built.approval, secret);
const out = process.env.APEX_OPERATOR_APPROVAL_PATH || ".operator/spy-approval.json";
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ ...built.approval, proof }, null, 2));
console.log(JSON.stringify({ signed: true, path: out, clientOrderId: built.approval.clientOrderId, storedInGit: false }));
