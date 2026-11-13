import { readFileSync, writeFileSync } from "node:fs";

const creds = JSON.parse(readFileSync("/workspace/.grok/paper-credentials.json", "utf8"));
const headers = {
  "APCA-API-KEY-ID": creds.keyId,
  "APCA-API-SECRET-KEY": creds.secret,
  "Content-Type": "application/json",
};
const paper = "https://paper-api.alpaca.markets";
const ticket = JSON.parse(readFileSync("/workspace/research/lab/crypto-paper-ticket.json", "utf8"));
const account = await (await fetch(`${paper}/v2/account`, { headers })).json();
const positions = await (await fetch(`${paper}/v2/positions`, { headers })).json();
const orders = await (await fetch(`${paper}/v2/orders?status=open`, { headers })).json();
const quote = (await (await fetch("https://data.alpaca.markets/v1beta3/crypto/us/latest/quotes?symbols=BTC/USD", { headers })).json()).quotes?.["BTC/USD"];
const ageSec = Math.round((Date.now() - Date.parse(ticket.quoteTs)) / 1000);
const askMove = Math.abs(quote.ap - ticket.ask) / ticket.ask;
const checks = {
  idMatches: ticket.clientOrderId === "apex-crypto-f0e7eaa9-5c78-4df7-9e81-3bccc6759ec2",
  accountActive: account.status === "ACTIVE",
  noPositions: positions.length === 0,
  noOpenOrders: orders.length === 0,
  quoteFresh: ageSec < 300,
  askStable: askMove < 0.002,
  cashOk: Number(account.cash) > 100,
};
const ok = Object.values(checks).every(Boolean);
if (!ok) {
  console.log(JSON.stringify({ submitted: false, reason: "checks failed", checks, ageSec, ask: quote.ap }, null, 2));
  process.exit(0);
}
const body = {
  symbol: "BTC/USD",
  qty: "0.001",
  side: "buy",
  type: "market",
  time_in_force: "gtc",
  client_order_id: ticket.clientOrderId,
};
const res = await fetch(`${paper}/v2/orders`, { method: "POST", headers, body: JSON.stringify(body) });
const order = await res.json();
writeFileSync("/workspace/research/lab/crypto-paper-ack.json", JSON.stringify({ status: res.status, order, checks, ageSec }, null, 2));
console.log(JSON.stringify({ http: res.status, id: order.id, status: order.status, qty: order.qty, filled: order.filled_qty, avg: order.filled_avg_price, client: order.client_order_id }, null, 2));
