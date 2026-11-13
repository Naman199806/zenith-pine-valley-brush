import { readFileSync, writeFileSync } from "node:fs";

const creds = JSON.parse(readFileSync("/workspace/.grok/paper-credentials.json", "utf8"));
const headers = {
  "APCA-API-KEY-ID": creds.keyId,
  "APCA-API-SECRET-KEY": creds.secret,
  "Content-Type": "application/json",
};
const paper = "https://paper-api.alpaca.markets";
const ticket = JSON.parse(readFileSync("/workspace/research/lab/crypto-sell-ticket.json", "utf8"));
const positions = await (await fetch(`${paper}/v2/positions`, { headers })).json();
const orders = await (await fetch(`${paper}/v2/orders?status=open`, { headers })).json();
const quote = (await (await fetch("https://data.alpaca.markets/v1beta3/crypto/us/latest/quotes?symbols=BTC/USD", { headers })).json()).quotes?.["BTC/USD"];
const btc = Array.isArray(positions) ? positions.find((p) => p.symbol === "BTCUSD") : null;
const ageSec = Math.round((Date.now() - Date.parse(ticket.quoteTs)) / 1000);
const checks = {
  idMatches: ticket.clientOrderId === "apex-crypto-sell-f703873b-7701-4c26-a24e-a185e21c27e9",
  qtyMatches: btc?.qty_available === "0.0009975",
  noOpenOrders: Array.isArray(orders) && orders.length === 0,
  quoteFresh: ageSec < 300,
};
if (!Object.values(checks).every(Boolean)) {
  console.log(JSON.stringify({ submitted: false, checks, available: btc?.qty_available, ageSec }, null, 2));
  process.exit(0);
}
const body = {
  symbol: "BTC/USD",
  qty: "0.0009975",
  side: "sell",
  type: "market",
  time_in_force: "gtc",
  client_order_id: ticket.clientOrderId,
};
const res = await fetch(`${paper}/v2/orders`, { method: "POST", headers, body: JSON.stringify(body) });
const order = await res.json();
writeFileSync("/workspace/research/lab/crypto-sell-ack.json", JSON.stringify({ status: res.status, order, checks, ageSec }, null, 2));
console.log(JSON.stringify({ http: res.status, id: order.id, status: order.status, qty: order.qty, filled: order.filled_qty, avg: order.filled_avg_price, client: order.client_order_id }, null, 2));
