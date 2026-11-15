/**
 * Strict LIVE read-only preflight.
 * Every request: HTTPS, exact live host, GET only, allowlisted path,
 * isolated LIVE credential namespace (never PAPER).
 * Fail closed on missing, malformed, or non-200 responses.
 * No credential access occurs inside this module.
 */

export const LIVE_ORIGIN = "https://api.alpaca.markets";

const ALLOWED_PATHS = [
  /^\/v2\/account$/,
  /^\/v2\/positions$/,
  /^\/v2\/orders$/,
  /^\/v2\/clock$/,
  /^\/v2\/assets\/[^/?]+$/,
];

export interface LiveReadOnlyTransport {
  get(url: string, init?: { headers?: Record<string, string> }): Promise<{ status: number; body: unknown }>;
}

export function assertStrictLiveGet(url: string, method = "GET"): URL {
  if (method !== "GET") throw new Error("LIVE preflight is GET-only");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("malformed URL");
  }
  if (parsed.protocol !== "https:") throw new Error("LIVE preflight requires HTTPS");
  if (parsed.hostname !== "api.alpaca.markets") throw new Error("exact live host required");
  if (parsed.username || parsed.password) throw new Error("credentials must not be embedded in URL");
  if (!ALLOWED_PATHS.some((re) => re.test(parsed.pathname))) throw new Error("endpoint not allowlisted");
  if (parsed.pathname === "/v2/orders" && !parsed.searchParams.has("status")) {
    throw new Error("orders endpoint requires status filter");
  }
  return parsed;
}

export interface AccountSchema {
  status: string;
  trading_blocked: boolean;
  account_blocked: boolean;
  buying_power: string;
  cash: string;
  crypto_status?: string;
}

export interface AssetSchema {
  tradable: boolean;
  fractionable: boolean;
  min_order_size?: string;
  min_trade_increment?: string;
}

function finiteNumber(value: unknown, field: string): number {
  const n = typeof value === "string" || typeof value === "number" ? Number(value) : NaN;
  if (!Number.isFinite(n)) throw new Error(`${field} is not a finite number`);
  return n;
}

function requireAccount(body: unknown): AccountSchema {
  if (!body || typeof body !== "object") throw new Error("account response malformed");
  const a = body as Record<string, unknown>;
  if (typeof a.status !== "string") throw new Error("account status missing");
  if (typeof a.trading_blocked !== "boolean") throw new Error("trading_blocked missing");
  if (a.crypto_status === undefined || a.crypto_status === null) throw new Error("crypto_status missing; fail closed");
  if (typeof a.crypto_status !== "string") throw new Error("crypto_status malformed");
  const buyingPower = finiteNumber(a.buying_power, "buying_power");
  const cash = finiteNumber(a.cash, "cash");
  return {
    status: a.status,
    trading_blocked: a.trading_blocked,
    account_blocked: Boolean(a.account_blocked),
    buying_power: String(buyingPower),
    cash: String(cash),
    crypto_status: a.crypto_status,
  };
}

function requireAsset(body: unknown): AssetSchema {
  if (!body || typeof body !== "object") throw new Error("asset response malformed");
  const a = body as Record<string, unknown>;
  if (typeof a.tradable !== "boolean") throw new Error("tradable missing");
  return {
    tradable: a.tradable,
    fractionable: Boolean(a.fractionable),
    min_order_size: typeof a.min_order_size === "string" ? a.min_order_size : undefined,
    min_trade_increment: typeof a.min_trade_increment === "string" ? a.min_trade_increment : undefined,
  };
}

export interface StrictPreflightResult {
  authorized: boolean;
  accountActive: boolean;
  tradingBlocked: boolean;
  accountBlocked: boolean;
  buyingPower: number | null;
  cash: number | null;
  cryptoPermitted: boolean | null;
  positions: number;
  openOrders: number;
  instrumentTradable: boolean | null;
  minOrderSize: number | null;
  blockers: string[];
  mode: "LIVE_READ_ONLY";
  canSubmit: false;
  credentialNamespace: "LIVE_APCA";
}

export async function strictLivePreflight(
  transport: LiveReadOnlyTransport,
  opts: { authorized: boolean; symbol: string; maxNotional: number },
): Promise<StrictPreflightResult> {
  const blockers: string[] = [];
  const result: StrictPreflightResult = {
    authorized: opts.authorized,
    accountActive: false,
    tradingBlocked: true,
    accountBlocked: true,
    buyingPower: null,
    cash: null,
    cryptoPermitted: null,
    positions: 0,
    openOrders: 0,
    instrumentTradable: null,
    minOrderSize: null,
    blockers,
    mode: "LIVE_READ_ONLY",
    canSubmit: false,
    credentialNamespace: "LIVE_APCA",
  };

  if (!opts.authorized) {
    blockers.push("separate LIVE read authorization required");
    return result;
  }
  if (opts.maxNotional <= 0 || opts.maxNotional > 25) {
    blockers.push("max notional must be positive and <= 25");
    return result;
  }

  try {
    const accountUrl = `${LIVE_ORIGIN}/v2/account`;
    assertStrictLiveGet(accountUrl);
    const accountRes = await transport.get(accountUrl);
    if (accountRes.status !== 200) throw new Error(`account ${accountRes.status}`);
    const account = requireAccount(accountRes.body);
    result.accountActive = account.status === "ACTIVE";
    result.tradingBlocked = account.trading_blocked;
    result.accountBlocked = account.account_blocked;
    result.buyingPower = Number(account.buying_power);
    result.cash = Number(account.cash);
    result.cryptoPermitted = account.crypto_status === "ACTIVE";
    if (!result.accountActive) blockers.push("account not ACTIVE");
    if (result.tradingBlocked) blockers.push("trading_blocked");
    if (result.accountBlocked) blockers.push("account_blocked");
    if (result.buyingPower != null && result.buyingPower < opts.maxNotional) blockers.push("insufficient buying power");
    if (!result.cryptoPermitted) blockers.push("crypto permission not ACTIVE");

    const posUrl = `${LIVE_ORIGIN}/v2/positions`;
    assertStrictLiveGet(posUrl);
    const posRes = await transport.get(posUrl);
    if (posRes.status !== 200 || !Array.isArray(posRes.body)) throw new Error("positions malformed");
    result.positions = posRes.body.length;

    const ordUrl = `${LIVE_ORIGIN}/v2/orders?status=open`;
    assertStrictLiveGet(ordUrl);
    const ordRes = await transport.get(ordUrl);
    if (ordRes.status !== 200 || !Array.isArray(ordRes.body)) throw new Error("open orders malformed");
    result.openOrders = ordRes.body.length;

    const assetUrl = `${LIVE_ORIGIN}/v2/assets/${encodeURIComponent(opts.symbol)}`;
    assertStrictLiveGet(assetUrl);
    const assetRes = await transport.get(assetUrl);
    if (assetRes.status !== 200) throw new Error(`asset ${assetRes.status}`);
    const asset = requireAsset(assetRes.body);
    result.instrumentTradable = asset.tradable;
    result.minOrderSize = asset.min_order_size != null ? Number(asset.min_order_size) : null;
    if (!asset.tradable) blockers.push("instrument not tradable");
    if (result.minOrderSize != null && opts.maxNotional < result.minOrderSize) {
      blockers.push("notional below minimum order size");
    }
  } catch (err) {
    blockers.push(err instanceof Error ? err.message : "preflight failed closed");
  }

  result.blockers = blockers;
  result.canSubmit = false;
  return result;
}
