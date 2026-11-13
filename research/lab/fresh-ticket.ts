import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { sizeFractionalOrder } from "/workspace/src/lib/apex/broker/risk-paper.ts";

const creds = JSON.parse(readFileSync("/workspace/.grok/paper-credentials.json", "utf8"));
const headers = { "APCA-API-KEY-ID": creds.keyId, "APCA-API-SECRET-KEY": creds.secret };
const accountRes = await fetch("https://paper-api.alpaca.markets/v2/account", { headers });
const assetRes = await fetch("https://paper-api.alpaca.markets/v2/assets/BTCUSD", { headers });
const positionsRes = await fetch("https://paper-api.alpaca.markets/v2/positions", { headers });
const ordersRes = await fetch("https://paper-api.alpaca.markets/v2/orders?status=open", { headers });
const quoteRes = await fetch("https://data.alpaca.markets/v1beta3/crypto/us/latest/quotes?symbols=BTC/USD", { headers });
const account = await accountRes.json();
const asset = await assetRes.json();
const positions = await positionsRes.json();
const orders = await ordersRes.json();
const quote = (await quoteRes.json()).quotes?.["BTC/USD"];
const equityCents = Math.round(Number(account.equity) * 100);
const cashCents = Math.round(Number(account.cash) * 100);
const askCents = Math.round(Number(quote.ap) * 100);
const risk = sizeFractionalOrder({
  equityCents,
  cashCents,
  entryPriceCents: askCents,
  stopPriceCents: Math.round(askCents * 0.99),
  openPositions: Array.isArray(positions) ? positions.length : 0,
  entriesToday: 0,
  dayDrawdown: 0,
  side: "buy",
  dataOk: Boolean(quote?.t),
  emergency: false,
  duplicate: false,
  closing: false,
  minuteEt: 18 * 60 + 29,
  increment: 0.0001,
  minQty: 0.0001,
  minNotionalCents: 100,
  feeBps: 0,
  applyEquityCutoff: false,
});
const ticket = {
  host: "paper-api.alpaca.markets",
  accountStatus: account.status,
  cash: account.cash,
  equity: account.equity,
  positions: Array.isArray(positions) ? positions.length : positions,
  openOrders: Array.isArray(orders) ? orders.length : orders,
  symbol: "BTC/USD",
  side: "buy",
  qty: "0.001",
  orderType: "market",
  timeInForce: "gtc",
  clientOrderId: `apex-crypto-${randomUUID()}`,
  bid: quote.bp,
  ask: quote.ap,
  spread: quote.ap - quote.bp,
  notional: 0.001 * quote.ap,
  tradable: asset.tradable,
  fractionable: asset.fractionable,
  feeModel: "Alpaca crypto paper. Not Kraken. Not the 0.16/0.26 Freqtrade schedule.",
  exit: "Operator-supervised market sell of the filled quantity. Not an automatic stop.",
  risk,
  submitted: false,
  quoteTs: quote.t,
};
writeFileSync("/workspace/research/lab/crypto-paper-ticket.json", JSON.stringify(ticket, null, 2));
console.log(JSON.stringify(ticket, null, 2));
