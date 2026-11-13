/** Paper hosts only. The live trading origin is refused even if an environment variable names it. */

export const PAPER_TRADING_ORIGIN = "https://paper-api.alpaca.markets";
export const DATA_ORIGIN = "https://data.alpaca.markets";
export const DATA_STREAM_URL = "wss://stream.data.alpaca.markets/v2/iex";
export const TRADE_STREAM_URL = "wss://paper-api.alpaca.markets/stream";
export const LIVE_TRADING_ORIGIN = "https://api.alpaca.markets";

const HOSTS = new Set(["paper-api.alpaca.markets", "data.alpaca.markets", "stream.data.alpaca.markets"]);

export function assertPaperUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== "https:" && url.protocol !== "wss:") {
    throw new Error("Blocked non-paper URL: only https and wss are allowed.");
  }
  if (url.username || url.password) throw new Error("Blocked URL with embedded credentials.");
  if (!HOSTS.has(url.hostname)) throw new Error(`Blocked host ${url.hostname}. Live trading is not allowed.`);
  if (url.hostname === "paper-api.alpaca.markets") {
    const ok = url.pathname.startsWith("/v2/") || url.pathname === "/stream" || url.pathname.startsWith("/stream/");
    if (!ok) throw new Error("Blocked paper-trading path.");
  }
  if (url.hostname === "data.alpaca.markets" && !url.pathname.startsWith("/v2/stocks/")) {
    throw new Error("Blocked market-data path.");
  }
  if (url.hostname === "stream.data.alpaca.markets" && url.pathname !== "/v2/iex") {
    throw new Error("Blocked market-data stream. SIP is not enabled.");
  }
  return url;
}

/** Environment cannot select the live host. A non-paper base URL blocks order submission. */
export function tradingOriginGuard(envBase: string | undefined): { origin: string; blockOrders: boolean; reason: string | null } {
  if (!envBase?.trim()) return { origin: PAPER_TRADING_ORIGIN, blockOrders: false, reason: null };
  let origin = "";
  try {
    origin = new URL(envBase).origin;
  } catch {
    return { origin: PAPER_TRADING_ORIGIN, blockOrders: true, reason: "APCA_API_BASE_URL is not a URL. Orders are blocked." };
  }
  if (origin === LIVE_TRADING_ORIGIN) {
    return { origin: PAPER_TRADING_ORIGIN, blockOrders: true, reason: "APCA_API_BASE_URL is the live trading host. Orders are blocked." };
  }
  if (origin !== PAPER_TRADING_ORIGIN) {
    return { origin: PAPER_TRADING_ORIGIN, blockOrders: true, reason: "APCA_API_BASE_URL is not the paper host. Orders are blocked." };
  }
  return { origin: PAPER_TRADING_ORIGIN, blockOrders: false, reason: null };
}

export function redactSecrets(text: string, secrets: string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret && secret.length > 3) out = out.split(secret).join("[redacted]");
  }
  return out;
}
