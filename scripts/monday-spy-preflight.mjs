#!/usr/bin/env node
/**
 * Monday regular-session preflight. GET only. Does not submit or sign.
 * The ticket includes nonce and the versioned authorization fields the signer requires.
 * Usage: node scripts/monday-spy-preflight.mjs
 */
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function buildMondaySpyTicket(input, now = Date.now()) {
  const blockers = [];
  const ids = input.ids ?? {};
  const clock = input.clock ?? {};
  const account = input.account ?? {};
  const asset = input.asset ?? {};
  const positions = input.positions;
  const open = input.open;
  const quoteIn = input.quote;
  if (typeof ids.nonce !== "string" || !ids.nonce) blockers.push("nonce missing");
  if (typeof ids.clientOrderId !== "string" || !ids.clientOrderId) blockers.push("clientOrderId missing");
  if (account.status !== "ACTIVE") blockers.push("account not ACTIVE");
  if (account.trading_blocked || account.account_blocked) blockers.push("account blocked");
  if (clock.is_open !== true) blockers.push("regular session closed");
  if (asset.tradable !== true) blockers.push("SPY not tradable");
  if (asset.fractionable !== true) blockers.push("SPY not fractionable");
  if (!Array.isArray(positions)) blockers.push("positions response incomplete");
  else if (positions.length !== 0) blockers.push("unexpected positions");
  if (!Array.isArray(open)) blockers.push("open orders response incomplete");
  else if (open.length !== 0) blockers.push("unexpected open orders");
  let quote = null;
  if (clock.is_open === true) {
    const bid = Number(quoteIn?.bp);
    const ask = Number(quoteIn?.ap);
    const age = now - Date.parse(quoteIn?.t ?? "");
    if (!(bid > 0) || !(ask > bid)) blockers.push("bid/ask invalid");
    if (!Number.isFinite(age) || age < 0) blockers.push("quote timestamp future or invalid");
    if (age > 5_000) blockers.push("quote older than 5 seconds");
    const mid = (bid + ask) / 2;
    const spreadBps = mid ? ((ask - bid) / mid) * 10000 : Infinity;
    if (spreadBps > 20) blockers.push("spread above 20 bps");
    quote = { bid, ask, spreadBps: Number(spreadBps.toFixed(2)), timestamp: quoteIn?.t ?? null, ageMs: age };
  }
  const limit = quote ? Math.round(quote.ask * 100) / 100 : null;
  const qty = limit ? Math.floor((25 / (limit * 1.001)) * 1000) / 1000 : null;
  if (blockers.length === 0 && (qty == null || limit == null)) blockers.push("quantity incomplete");
  const worst = limit && qty ? qty * limit * 1.001 : null;
  return {
    verdict: blockers.length ? "NO-GO" : "READY_FOR_OPERATOR_APPROVAL",
    blockers,
    submitted: false,
    authorizationConsumed: false,
    operatorAuthorized: false,
    v: 1,
    clientOrderId: ids.clientOrderId ?? null,
    nonce: ids.nonce ?? null,
    symbol: "SPY",
    side: "buy",
    orderType: "limit",
    timeInForce: "day",
    session: "REGULAR",
    category: "CONNECTIVITY_TEST",
    exitAuthorizationId: null,
    linkedEntryId: null,
    qty,
    limitPrice: limit,
    expiresAt: clock.next_close ?? null,
    worstCaseNotional: worst == null ? null : Number(worst.toFixed(4)),
    quote,
    account: { status: account.status ?? null, tradingBlocked: account.trading_blocked ?? null, accountBlocked: account.account_blocked ?? null },
    spy: { tradable: asset.tradable ?? null, fractionable: asset.fractionable ?? null },
    positions: Array.isArray(positions) ? positions.length : null,
    openOrders: Array.isArray(open) ? open.length : null,
    stop: "Explicit exact-ticket authorization required. This command does not submit.",
  };
}

async function main() {
  const env = Object.fromEntries(readFileSync(".env", "utf8").split("\n").filter((line) => line && !line.startsWith("#") && line.includes("=")).map((line) => {
    const index = line.indexOf("=");
    return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^"|"$/g, "")];
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
  const quoteRes = clock.body?.is_open ? await get("https://data.alpaca.markets/v2/stocks/SPY/quotes/latest?feed=iex") : null;
  const ticket = buildMondaySpyTicket({
    ids: { nonce: randomUUID(), clientOrderId: `apex-spy-${randomUUID()}` },
    clock: clock.body ?? {},
    account: account.body ?? {},
    asset: asset.body ?? {},
    positions: positions.body,
    open: open.body,
    quote: quoteRes?.body?.quote ?? null,
  });
  ticket.blockers = [...blockers, ...ticket.blockers];
  if (ticket.blockers.length) ticket.verdict = "NO-GO";
  writeFileSync("research/lab/monday-spy-preflight.json", JSON.stringify(ticket, null, 2));
  console.log(JSON.stringify({ verdict: ticket.verdict, blockers: ticket.blockers, submitted: false }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "preflight failed");
    process.exit(1);
  });
}
