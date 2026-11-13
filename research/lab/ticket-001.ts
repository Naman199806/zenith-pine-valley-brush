import { readFileSync, writeFileSync } from "node:fs";

const creds = JSON.parse(readFileSync("/workspace/.grok/paper-credentials.json", "utf8"));
const headers = { "APCA-API-KEY-ID": creds.keyId, "APCA-API-SECRET-KEY": creds.secret };
const asset = await fetch("https://paper-api.alpaca.markets/v2/assets/BTCUSD", { headers });
const quote = await fetch("https://data.alpaca.markets/v1beta3/crypto/us/latest/quotes?symbols=BTC/USD", { headers });
const a = await asset.json();
const q = (await quote.json()).quotes?.["BTC/USD"];
const ticket = {
  symbol: "BTC/USD",
  side: "buy",
  qty: "0.001",
  orderType: "market",
  timeInForce: "gtc",
  bid: q?.bp,
  ask: q?.ap,
  spread: q?.ap && q?.bp ? q.ap - q.bp : null,
  notional: q?.ap ? 0.001 * q.ap : null,
  tradable: a.tradable,
  fractionable: a.fractionable,
  exit: "Operator-supervised market sell of the filled quantity. No crypto bracket. A stop is not guaranteed on a gap.",
  submitted: false,
  quoteTs: q?.t,
  note: "Inside the fractional risk budget. Not submitted. Approval required.",
};
writeFileSync("/workspace/research/lab/crypto-paper-ticket.json", JSON.stringify(ticket, null, 2));
console.log(JSON.stringify(ticket));
