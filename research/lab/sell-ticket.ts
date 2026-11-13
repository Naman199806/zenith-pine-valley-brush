import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const creds = JSON.parse(readFileSync("/workspace/.grok/paper-credentials.json", "utf8"));
const headers = { "APCA-API-KEY-ID": creds.keyId, "APCA-API-SECRET-KEY": creds.secret };
const paper = "https://paper-api.alpaca.markets";
const account = await (await fetch(`${paper}/v2/account`, { headers })).json();
const positions = await (await fetch(`${paper}/v2/positions`, { headers })).json();
const orders = await (await fetch(`${paper}/v2/orders?status=open`, { headers })).json();
const activities = await (await fetch(`${paper}/v2/account/activities?activity_types=CFEE,FEE,FILL&page_size=20`, { headers })).json();
const quote = (await (await fetch("https://data.alpaca.markets/v1beta3/crypto/us/latest/quotes?symbols=BTC/USD", { headers })).json()).quotes?.["BTC/USD"];
const btc = Array.isArray(positions) ? positions.find((p) => p.symbol === "BTCUSD") : null;
const qty = btc?.qty_available ?? btc?.qty ?? null;
const ticket = {
  host: "paper-api.alpaca.markets",
  accountStatus: account.status,
  cash: account.cash,
  equity: account.equity,
  openOrders: Array.isArray(orders) ? orders.length : orders,
  symbol: "BTC/USD",
  side: "sell",
  qty,
  orderType: "market",
  timeInForce: "gtc",
  clientOrderId: `apex-crypto-sell-${randomUUID()}`,
  bid: quote?.bp,
  ask: quote?.ap,
  estimatedProceeds: qty && quote?.bp ? Number(qty) * quote.bp : null,
  cannotShort: true,
  duplicateSellBlocked: Array.isArray(orders) && orders.some((o) => o.side === "sell" && String(o.symbol).includes("BTC")),
  exit: "Close the existing long only. Not a short. Not automatic.",
  submitted: false,
  quoteTs: quote?.t,
  activities: Array.isArray(activities) ? activities.slice(0, 8) : activities,
};
writeFileSync("/workspace/research/lab/crypto-sell-ticket.json", JSON.stringify(ticket, null, 2));
console.log(JSON.stringify({ qty, bid: quote?.bp, ask: quote?.ap, proceeds: ticket.estimatedProceeds, activities: ticket.activities, openOrders: ticket.openOrders }, null, 2));
