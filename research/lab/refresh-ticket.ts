import { readFileSync, writeFileSync } from "node:fs";
import { sizePaperOrder } from "/workspace/src/lib/apex/broker/risk-paper.ts";
const creds = JSON.parse(readFileSync("/workspace/.grok/paper-credentials.json", "utf8"));
const headers = { "APCA-API-KEY-ID": creds.keyId, "APCA-API-SECRET-KEY": creds.secret };
const asset = await fetch("https://paper-api.alpaca.markets/v2/assets/BTCUSD", { headers });
const quote = await fetch("https://data.alpaca.markets/v1beta3/crypto/us/latest/quotes?symbols=BTC/USD", { headers });
const a = await asset.json();
const q = (await quote.json()).quotes?.["BTC/USD"];
const risk = sizePaperOrder({
  equityCents: 10_544_280,
  cashCents: 10_544_280,
  entryPriceCents: Math.round((q?.ap || 0) * 100),
  stopPriceCents: Math.round((q?.ap || 0) * 100 * 0.99),
  openPositions: 0,
  entriesToday: 0,
  dayDrawdown: 0,
  side: "buy",
  dataOk: true,
  emergency: false,
  duplicate: false,
  closing: false,
  minuteEt: 11 * 60,
});
const ticket = {
  symbol: "BTC/USD",
  side: "buy",
  qty: 0.001,
  orderType: "market",
  timeInForce: "gtc",
  bid: q?.bp,
  ask: q?.ap,
  spread: q?.ap && q?.bp ? q.ap - q.bp : null,
  notional: q?.ap ? 0.001 * q.ap : null,
  tradable: a.tradable,
  fractionable: a.fractionable,
  shortable: a.shortable,
  riskQty: risk.qty,
  riskReasons: risk.reasons,
  exit: "Supervised market sell of the filled quantity. No crypto bracket. A stop is not guaranteed on a gap.",
  submitted: false,
  quoteTs: q?.t,
};
writeFileSync("/workspace/research/lab/crypto-paper-ticket.json", JSON.stringify(ticket, null, 2));
console.log(JSON.stringify(ticket));
