import { readFileSync, writeFileSync } from "node:fs";
const creds = JSON.parse(readFileSync("/workspace/.grok/paper-credentials.json", "utf8"));
const headers = { "APCA-API-KEY-ID": creds.keyId, "APCA-API-SECRET-KEY": creds.secret };
const id = "9e3b834f-9ff0-46fb-ba11-344061d91e62";
const order = await (await fetch(`https://paper-api.alpaca.markets/v2/orders/${id}`, { headers })).json();
const positions = await (await fetch("https://paper-api.alpaca.markets/v2/positions", { headers })).json();
const openOrders = await (await fetch("https://paper-api.alpaca.markets/v2/orders?status=open", { headers })).json();
const account = await (await fetch("https://paper-api.alpaca.markets/v2/account", { headers })).json();
const report = {
  orderId: order.id,
  clientOrderId: order.client_order_id,
  status: order.status,
  qty: order.qty,
  filledQty: order.filled_qty,
  filledAvg: order.filled_avg_price,
  filledAt: order.filled_at,
  commission: order.commission ?? null,
  positions,
  openOrders: Array.isArray(openOrders) ? openOrders.length : openOrders,
  cash: account.cash,
  equity: account.equity,
};
writeFileSync("/workspace/research/lab/crypto-sell-fill.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
