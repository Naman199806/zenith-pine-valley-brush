import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { evaluateFmz, completedBars } from "../src/lib/apex/research/fmz-bb-rsi.ts";
import { pilotEntryCount } from "../src/lib/apex/research/pilot-ledger.ts";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(readFileSync(join(root, ".env"), "utf8").split(/\n/).filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => {
  const i = l.indexOf("=");
  return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, "")];
}));
const headers = { "APCA-API-KEY-ID": env.APCA_API_KEY_ID || "", "APCA-API-SECRET-KEY": env.APCA_API_SECRET_KEY || "" };
const auth = JSON.parse(readFileSync(join(root, "research/lab/paper-pilot-auth.json"), "utf8"));

async function readJson(url) {
  const res = await fetch(url, { headers });
  const text = await res.text();
  try {
    return { ok: res.ok, status: res.status, body: JSON.parse(text) };
  } catch {
    return { ok: false, status: res.status, error: `non-json status=${res.status} body=${text.slice(0, 180).replace(/\s+/g, " ")}` };
  }
}

async function tick() {
  const end = new Date();
  const start = new Date(end.getTime() - 8 * 24 * 60 * 60 * 1000);
  const barsUrl = `https://data.alpaca.markets/v1beta3/crypto/us/bars?symbols=BTC/USD&timeframe=15Min&start=${start.toISOString()}&end=${end.toISOString()}&limit=1000&sort=desc`;
  const bars = await readJson(barsUrl);
  const orders = await readJson("https://paper-api.alpaca.markets/v2/orders?status=all&limit=50&symbols=BTC/USD");
  const account = await readJson("https://paper-api.alpaca.markets/v2/account");
  const positions = await readJson("https://paper-api.alpaca.markets/v2/positions");
  const raw = bars.body?.bars?.["BTC/USD"] || [];
  const completed = completedBars(raw.map((b) => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c })).reverse());
  const signal = evaluateFmz(completed, 250);
  const entries = Array.isArray(orders.body) ? pilotEntryCount(orders.body, auth.activated_at_utc) : null;
  const expired = Date.now() >= Date.parse(auth.expires_at_utc);
  const killed = existsSync(join(root, "research/lab/windows/KILL"));
  const brokerError = [bars, orders, account, positions].find((r) => r.error || !r.ok)?.error || null;
  const stopLimit = signal.atr14 && signal.close ? Number((signal.close - 1.5 * signal.atr14).toFixed(2)) : null;
  const state = {
    pid: process.pid,
    heartbeat: new Date().toISOString(),
    status: killed ? "STOPPED" : expired ? "EXPIRED" : brokerError ? "BLOCKED" : "WAITING",
    activated_at_utc: auth.activated_at_utc,
    expires_at_utc: auth.expires_at_utc,
    signal: signal.signal,
    rsi: signal.rsi,
    lower: signal.lower,
    upper: signal.upper,
    atr14: signal.atr14,
    lastBar: signal.barTime,
    entries,
    cash: account.body?.cash ?? null,
    btcQty: Array.isArray(positions.body) ? (positions.body.find((p) => /BTC/.test(p.symbol))?.qty || "0") : "unknown",
    automatedEntries: false,
    stopLimit,
    stopLimitPrice: stopLimit == null ? null : Number((stopLimit * auth.protectiveOffset).toFixed(2)),
    brokerError,
    reason: brokerError || "Host verification required before entries. Offset approved at 0.995.",
  };
  writeFileSync(join(root, "research/lab/paper-pilot-heartbeat.json"), JSON.stringify(state, null, 2));
  console.log(JSON.stringify(state));
}

tick().catch((err) => console.error(err.message));
setInterval(() => { tick().catch((err) => console.error(err.message)); }, 60_000);
