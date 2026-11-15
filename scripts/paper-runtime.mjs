import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { acquireLock, releaseLock, touchLock } from "../src/lib/apex/runtime/lock.ts";
import { classifyBrokerResponse, staleCandleError } from "../src/lib/apex/runtime/broker.ts";
import { completedBars } from "../src/lib/apex/research/fmz-bb-rsi.ts";
import { oracleFeed, pulseFeed, voltaFeed } from "../src/lib/apex/research/public-feeds.ts";
import { decide, candleCloseMs } from "../src/lib/apex/runtime/decision.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "research/lab/windows");
mkdirSync(dir, { recursive: true });
const lockPath = join(dir, "runtime.lock");
const heartbeatPath = join(root, "research/lab/paper-runtime-heartbeat.json");
const config = JSON.parse(readFileSync(join(root, "research/lab/paper-runtime-disabled.json"), "utf8"));
const lock = acquireLock(lockPath);
if (!lock.acquired) {
  console.log(JSON.stringify({ status: "LOCKED", existingPid: lock.existingPid }));
  process.exit(0);
}

let bars = [];
let account = { cash: null, btcQty: "unknown", error: null };
let feeds = { oracle: [], pulse: [], volta: [] };
let quotes = [];
let lastCandleFetch = 0;

function env() {
  const path = join(root, ".env");
  if (!existsSync(path)) return {};
  return Object.fromEntries(readFileSync(path, "utf8").split(/\n/).filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => {
    const i = l.indexOf("=");
    return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, "")];
  }));
}

async function readJson(url, headers) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
  return classifyBrokerResponse(res.status, await res.text());
}

async function refreshEvidence(force = false) {
  const now = Date.now();
  if (!force && now - lastCandleFetch < 60_000) return;
  lastCandleFetch = now;
  const keys = env();
  const headers = { "APCA-API-KEY-ID": keys.APCA_API_KEY_ID || "", "APCA-API-SECRET-KEY": keys.APCA_API_SECRET_KEY || "" };
  if (!headers["APCA-API-KEY-ID"]) {
    account.error = "missing paper credentials";
    return;
  }
  const end = new Date();
  const start = new Date(end.getTime() - 8 * 24 * 60 * 60 * 1000);
  const barsUrl = `https://data.alpaca.markets/v1beta3/crypto/us/bars?symbols=BTC/USD&timeframe=15Min&start=${start.toISOString()}&end=${end.toISOString()}&limit=1000&sort=desc`;
  const [barRes, accountRes, positionRes] = await Promise.all([
    readJson(barsUrl, headers),
    readJson("https://paper-api.alpaca.markets/v2/account", headers),
    readJson("https://paper-api.alpaca.markets/v2/positions", headers),
  ]);
  if (barRes.ok) {
    bars = completedBars((barRes.body?.bars?.["BTC/USD"] || []).map((b) => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c })).reverse());
  }
  const lastBar = bars.at(-1)?.t ?? null;
  account = {
    cash: accountRes.body?.cash ?? null,
    btcQty: Array.isArray(positionRes.body) ? (positionRes.body.find((p) => /BTC/.test(p.symbol))?.qty || "0") : "unknown",
    error: [barRes, accountRes, positionRes].find((r) => r.error)?.error || staleCandleError(lastBar ? new Date(candleCloseMs(lastBar)).toISOString() : null),
  };
  const [oracle, pulse, volta, eth, spy] = await Promise.all([oracleFeed(), pulseFeed(), voltaFeed(), readJson("https://data.alpaca.markets/v1beta3/crypto/us/latest/quotes?symbols=ETH/USD", headers), fetch("https://query1.finance.yahoo.com/v8/finance/chart/SPY?interval=1d&range=1d", { signal: AbortSignal.timeout(8000) }).then((r) => r.json()).catch(() => null)]);
  feeds = { oracle: oracle.observations, pulse: pulse.observations, volta: volta.observations };
  const btcQuote = bars.at(-1);
  const spyMeta = spy?.chart?.result?.[0]?.meta;
  quotes = [
    { symbol: "BTC/USD", price: btcQuote?.c ?? null, observedAt: btcQuote?.t ? new Date(candleCloseMs(btcQuote.t)).toISOString() : null, source: "alpaca-crypto-bars", session: "24/7" },
    { symbol: "ETH/USD", price: eth.body?.quotes?.["ETH/USD"]?.ap ?? null, observedAt: eth.body?.quotes?.["ETH/USD"]?.t ?? null, source: "alpaca-crypto-quotes", session: "24/7" },
    { symbol: "SPY", price: spyMeta?.regularMarketPrice ?? null, observedAt: spyMeta?.regularMarketTime ? new Date(spyMeta.regularMarketTime * 1000).toISOString() : null, source: "yahoo", session: "US_EQUITY" },
  ];
}

let ticking = false;
async function tick() {
  if (ticking) return;
  ticking = true;
  try {
  await refreshEvidence();
  const decision = decide({ quotes, oracle: feeds.oracle, pulse: feeds.pulse, volta: feeds.volta, authorizationExpiresAt: null, ownedQty: Number(account.btcQty || 0), cash: Number(account.cash || 0), price: quotes.find((q) => q.symbol === "BTC/USD")?.price ?? 0 });
  const state = {
    pid: process.pid,
    heartbeat: new Date().toISOString(),
    status: "DISABLED",
    config: config.id,
    decision,
    traceId: decision.traceId,
    signal: decision.decision,
    dataQuality: decision.dataQuality,
    selected: "NO_WINNER",
    feeds: { oracle: feeds.oracle.length, pulse: feeds.pulse.length, volta: feeds.volta.length },
    cash: account.cash,
    btcQty: account.btcQty,
    automatedEntries: false,
    brokerWrites: 0,
    brokerError: account.error,
    reason: config.reason,
  };
  writeFileSync(heartbeatPath, JSON.stringify(state, null, 2));
  touchLock(lockPath);
  console.log(JSON.stringify({ heartbeat: state.heartbeat, signal: state.signal, brokerWrites: 0, brokerError: state.brokerError }));
  } finally {
    ticking = false;
  }
}

const timer = setInterval(() => { tick().catch((err) => console.error(err.message)); }, 30_000);
await tick();
function shutdown() {
  clearInterval(timer);
  releaseLock(lockPath);
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
