#!/usr/bin/env node
/**
 * Monday regular-session preflight. GET only. Stops before submission.
 * Usage: node scripts/monday-spy-preflight.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";

const env = Object.fromEntries(readFileSync(".env", "utf8").split("\n").filter((l) => l && !l.startsWith("#") && l.includes("=")).map((l) => {
  const i = l.indexOf("=");
  return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")];
}));
if (!env.APCA_API_KEY_ID?.startsWith("PK")) {
  console.log(JSON.stringify({ verdict: "NO-GO", reason: "PAPER key required" }));
  process.exit(1);
}
const headers = { "APCA-API-KEY-ID": env.APCA_API_KEY_ID, "APCA-API-SECRET-KEY": env.APCA_API_SECRET_KEY };
async function get(url) {
  const res = await fetch(url, { headers });
  return { status: res.status, body: await res.json() };
}
const clock = await get("https://paper-api.alpaca.markets/v2/clock");
const account = await get("https://paper-api.alpaca.markets/v2/account");
const asset = await get("https://paper-api.alpaca.markets/v2/assets/SPY");
const positions = await get("https://paper-api.alpaca.markets/v2/positions");
const open = await get("https://paper-api.alpaca.markets/v2/orders?status=open");
if (!clock.body.is_open) {
  const report = { verdict: "NO-GO", reason: "regular session closed", nextOpen: clock.body.next_open, submitted: false };
  writeFileSync("research/lab/monday-spy-preflight.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}
const quote = await get("https://data.alpaca.markets/v2/stocks/SPY/quotes/latest?feed=iex");
const q = quote.body.quote || {};
const bid = Number(q.bp), ask = Number(q.ap);
const mid = (bid + ask) / 2;
const spreadBps = mid ? (ask - bid) / mid * 10000 : Infinity;
const limit = Math.round(ask * 100) / 100;
const qty = Math.floor((25 / (limit * 1.001)) * 1000) / 1000;
const worst = qty * limit * 1.001;
const ticket = {
  verdict: spreadBps <= 20 && worst <= 25 ? "READY_FOR_OPERATOR_APPROVAL" : "NO-GO",
  submitted: false,
  operatorAuthorized: false,
  symbol: "SPY",
  side: "buy",
  type: "limit",
  time_in_force: "day",
  session: "REGULAR",
  qty,
  limitPrice: limit,
  worstCaseNotional: Number(worst.toFixed(4)),
  quote: { bid, ask, spreadBps: Number(spreadBps.toFixed(2)), timestamp: q.t },
  account: { status: account.body.status, tradingBlocked: account.body.trading_blocked },
  spy: { tradable: asset.body.tradable, fractionable: asset.body.fractionable },
  positions: Array.isArray(positions.body) ? positions.body.length : null,
  openOrders: Array.isArray(open.body) ? open.body.length : null,
  stop: "Explicit authorization required. This command does not submit.",
};
writeFileSync("research/lab/monday-spy-preflight.json", JSON.stringify(ticket, null, 2));
console.log(JSON.stringify(ticket, null, 2));
