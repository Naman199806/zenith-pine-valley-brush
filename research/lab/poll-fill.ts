import { readFileSync, writeFileSync } from "node:fs";
const creds = JSON.parse(readFileSync("/workspace/.grok/paper-credentials.json", "utf8"));
const headers = { "APCA-API-KEY-ID": creds.keyId, "APCA-API-SECRET-KEY": creds.secret };
const id = "c9f6371e-7add-451f-b612-4b5358066509";
const order = await (await fetch(`https://paper-api.alpaca.markets/v2/orders/${id}`, { headers })).json();
const positions = await (await fetch("https://paper-api.alpaca.markets/v2/positions", { headers })).json();
const account = await (await fetch("https://paper-api.alpaca.markets/v2/account", { headers })).json();
const report = {
  orderId: order.id,
  clientOrderId: order.client_order_id,
  status: order.status,
  qty: order.qty,
  filledQty: order.filled_qty,
  filledAvg: order.filled_avg_price,
  submittedAt: order.submitted_at,
  filledAt: order.filled_at,
  fees: order.commission ?? null,
  positions,
  cash: account.cash,
  equity: account.equity,
};
writeFileSync("/workspace/research/lab/crypto-paper-fill.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
