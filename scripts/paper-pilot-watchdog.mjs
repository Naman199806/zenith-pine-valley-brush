import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { evaluateFmz, completedBars } from "../src/lib/apex/research/fmz-bb-rsi.ts";
import { pilotEntryCount } from "../src/lib/apex/research/pilot-ledger.ts";

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(readFileSync(join(root, ".env"), "utf8").split(/\n/).filter((l) => l.includes("=")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; }));
const headers = { "APCA-API-KEY-ID": env.APCA_API_KEY_ID, "APCA-API-SECRET-KEY": env.APCA_API_SECRET_KEY };
const auth = JSON.parse(readFileSync(join(root, "research/lab/paper-pilot-auth.json"), "utf8"));

async function tick() {
  const end = new Date();
  const start = new Date(end.getTime() - 8 * 24 * 60 * 60 * 1000);
  const barsRes = await fetch(`https://data.alpaca.markets/v1beta3/crypto/us/bars?symbols=BTC/USD&timeframe=15Min&start=${start.toISOString()}&end=${end.toISOString()}&limit=1000&sort=desc`, { headers });
  const barsBody = await barsRes.json();
  const raw = (barsBody.bars?.["BTC/USD"] || []).map((b) => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c })).reverse();
  const bars = completedBars(raw);
  const signal = evaluateFmz(bars, 250);
  const orders = await (await fetch("https://paper-api.alpaca.markets/v2/orders?status=all&limit=50&symbols=BTC/USD", { headers })).json();
  const entries = Array.isArray(orders) ? pilotEntryCount(orders, auth.activated_at_utc) : null;
  const account = await (await fetch("https://paper-api.alpaca.markets/v2/account", { headers })).json();
  const positions = await (await fetch("https://paper-api.alpaca.markets/v2/positions", { headers })).json();
  const expired = Date.now() >= Date.parse(auth.expires_at_utc);
  const killed = existsSync(join(root, "research/lab/windows/KILL"));
  const stopLimit = signal.atr14 && signal.close ? Number((signal.close - 1.5 * signal.atr14).toFixed(2)) : null;
  const stopLimitPrice = stopLimit == null ? null : Number((stopLimit * auth.protectiveOffset).toFixed(2));
  const state = {
    pid: process.pid,
    heartbeat: new Date().toISOString(),
    status: killed ? "STOPPED" : expired ? "EXPIRED" : "WAITING",
    activated_at_utc: auth.activated_at_utc,
    expires_at_utc: auth.expires_at_utc,
    signal: signal.signal,
    rsi: signal.rsi,
    lower: signal.lower,
    upper: signal.upper,
    atr14: signal.atr14,
    lastBar: signal.barTime,
    entries,
    cash: account.cash,
    btcQty: Array.isArray(positions) ? (positions.find((p) => /BTC/.test(p.symbol))?.qty || "0") : "unknown",
    automatedEntries: false,
    stopLimit,
    stopLimitPrice,
    reason: "Host verification required before entries. Offset approved at 0.995.",
  };
  writeFileSync(join(root, "research/lab/paper-pilot-heartbeat.json"), JSON.stringify(state, null, 2));
  console.log(JSON.stringify(state));
}

await tick();
setInterval(() => { tick().catch((err) => console.error(err.message)); }, 60_000);
