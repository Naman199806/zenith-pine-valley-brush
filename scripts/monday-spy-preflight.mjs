#!/usr/bin/env node
/**
 * Monday regular-session preflight. GET only. Does not submit or consume authorization.
 * Usage: node scripts/monday-spy-preflight.mjs
 */
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const env = Object.fromEntries(readFileSync(".env", "utf8").split("\n").filter((l) => l && !l.startsWith("#") && l.includes("=")).map((l) => {
  const i = l.indexOf("=");
  return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")];
}));
const blockers = [];
if (!env.APCA_API_KEY_ID?.startsWith("PK")) blockers.push("PAPER key required");
const headers = { "APCA-API-KEY-ID": env.APCA_API_KEY_ID || "", "APCA-API-SECRET-KEY": env.APCA_API_SECRET_KEY || "" };
async function get(url) {
  const res = await fetch(url, { headers });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const clock = await get("https://paper-api.alpaca.markets/v2/clock");
const account = await get("https://paper-api.alpaca.markets/v2/account");
const asset = await get("https://paper-api.alpaca.markets/v2/assets/SPY");
const positions = await get("https://paper-api.alpaca.markets/v2/positions");
const open = await get("https://paper-api.alpaca.markets/v2/orders?status=open");
for (const [name, res] of [["clock", clock], ["account", account], ["asset", asset], ["positions", positions], ["open", open]]) {
  if (res.status !== 200) blockers.push(`${name} HTTP ${res.status}`);
}
if (account.body?.status !== "ACTIVE") blockers.push("account not ACTIVE");
if (account.body?.trading_blocked || account.body?.account_blocked) blockers.push("account blocked");
if (!clock.body?.is_open) blockers.push("regular session closed");
if (asset.body?.tradable !== true) blockers.push("SPY not tradable");
if (asset.body?.fractionable !== true) blockers.push("SPY not fractionable");
let quote = null;
if (clock.body?.is_open) {
  const qres = await get("https://data.alpaca.markets/v2/stocks/SPY/quotes/latest?feed=iex");
  if (qres.status !== 200) blockers.push(`quote HTTP ${qres.status}`);
  const q = qres.body?.quote || {};
  const bid = Number(q.bp);
  const ask = Number(q.ap);
  const age = Date.now() - Date.parse(q.t);
  if (!(bid > 0) || !(ask > bid)) blockers.push("bid/ask invalid");
  if (!Number.isFinite(age) || age > 5_000) blockers.push("quote older than 5 seconds");
  const mid = (bid + ask) / 2;
  const spreadBps = mid ? (ask - bid) / mid * 10000 : Infinity;
  if (spreadBps > 20) blockers.push("spread above 20 bps");
  quote = { bid, ask, spreadBps: Number(spreadBps.toFixed(2)), timestamp: q.t, ageMs: age };
}
const limit = quote ? Math.round(quote.ask * 100) / 100 : null;
const qty = limit ? Math.floor((25 / (limit * 1.001)) * 1000) / 1000 : null;
const worst = limit && qty ? qty * limit * 1.001 : null;
if (qty != null && (!(qty > 0) || !Number.isFinite(qty))) blockers.push("quantity invalid");
const ticket = {
  verdict: blockers.length ? "NO-GO" : "READY_FOR_OPERATOR_APPROVAL",
  blockers,
  submitted: false,
  authorizationConsumed: false,
  operatorAuthorized: false,
  clientOrderId: `apex-spy-${randomUUID()}`,
  expiresAt: clock.body?.next_close || null,
  symbol: "SPY",
  side: "buy",
  type: "limit",
  time_in_force: "day",
  session: "REGULAR",
  qty,
  limitPrice: limit,
  worstCaseNotional: worst == null ? null : Number(worst.toFixed(4)),
  quote,
  account: { status: account.body?.status, tradingBlocked: account.body?.trading_blocked, accountBlocked: account.body?.account_blocked },
  spy: { tradable: asset.body?.tradable, fractionable: asset.body?.fractionable },
  positions: Array.isArray(positions.body) ? positions.body.length : null,
  openOrders: Array.isArray(open.body) ? open.body.length : null,
  stop: "Explicit exact-ticket authorization required. This command does not submit.",
};
writeFileSync("research/lab/monday-spy-preflight.json", JSON.stringify(ticket, null, 2));
console.log(JSON.stringify(ticket, null, 2));
