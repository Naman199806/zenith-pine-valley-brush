/**
 * Isolated supervised LIVE connectivity path.
 * Disabled by default. GET-only preflight. No order submission without
 * separate explicit CONNECTIVITY_TEST authorization that is never granted
 * by this module.
 *
 * strategyApproved remains false. Autonomous LIVE remains prohibited.
 * This does not convert the read-only runtime into an unrestricted executor.
 */

export const CONNECTIVITY_TEST = "CONNECTIVITY_TEST" as const;
export const STRATEGY_TRADE = "STRATEGY_TRADE" as const;

export type AuthorizationCategory = typeof CONNECTIVITY_TEST | typeof STRATEGY_TRADE;

export interface LivePreflightResult {
  authorized: boolean;
  accountActive: boolean;
  tradingBlocked: boolean;
  cashAvailable: number | null;
  positions: number;
  openOrders: number;
  instrumentTradable: boolean | null;
  estimatedNotional: number | null;
  blockers: string[];
  mode: "LIVE_READ_ONLY";
  canSubmit: false;
}

export interface LiveReadOnlyTransport {
  get(url: string): Promise<{ status: number; body: unknown }>;
}

const LIVE_ORIGIN = "https://api.alpaca.markets";
const ALLOWED_GET = [
  /^\/v2\/account$/,
  /^\/v2\/positions$/,
  /^\/v2\/orders$/,
  /^\/v2\/clock$/,
  /^\/v2\/assets\/[^/]+$/,
];

export function assertLiveGetOnly(url: string, method = "GET"): void {
  if (method !== "GET") throw new Error("LIVE preflight is GET-only; order submission is blocked");
  const parsed = new URL(url);
  if (parsed.hostname !== "api.alpaca.markets") throw new Error("not the live host");
  if (!ALLOWED_GET.some((re) => re.test(parsed.pathname))) throw new Error("endpoint not allowlisted for LIVE preflight");
  if (parsed.pathname === "/v2/orders" && parsed.searchParams.has("status") === false && parsed.search === "") {
    throw new Error("unfiltered order list blocked to prevent accidental submission path");
  }
}

export async function liveAccountPreflight(
  transport: LiveReadOnlyTransport,
  opts: {
    authorized: boolean;
    symbol: string;
    maxNotional: number;
  },
): Promise<LivePreflightResult> {
  const blockers: string[] = [];
  if (!opts.authorized) blockers.push("separate LIVE read authorization required");
  if (opts.maxNotional <= 0 || opts.maxNotional > 25) blockers.push("max notional must be positive and <= 25 for connectivity test");

  const result: LivePreflightResult = {
    authorized: opts.authorized,
    accountActive: false,
    tradingBlocked: true,
    cashAvailable: null,
    positions: 0,
    openOrders: 0,
    instrumentTradable: null,
    estimatedNotional: null,
    blockers,
    mode: "LIVE_READ_ONLY",
    canSubmit: false,
  };

  if (!opts.authorized) return result;

  try {
    assertLiveGetOnly(`${LIVE_ORIGIN}/v2/account`);
    const account = await transport.get(`${LIVE_ORIGIN}/v2/account`);
    if (account.status !== 200) {
      blockers.push(`account endpoint ${account.status}`);
      return result;
    }
    const body = account.body as { status?: string; trading_blocked?: boolean; cash?: string };
    result.accountActive = body.status === "ACTIVE";
    result.tradingBlocked = Boolean(body.trading_blocked);
    result.cashAvailable = body.cash != null ? Number(body.cash) : null;
    if (!result.accountActive) blockers.push("LIVE account is not ACTIVE");
    if (result.tradingBlocked) blockers.push("trading is blocked on LIVE account");
    if (result.cashAvailable != null && result.cashAvailable < opts.maxNotional) {
      blockers.push("insufficient cash for proposed notional");
    }

    const positions = await transport.get(`${LIVE_ORIGIN}/v2/positions`);
    result.positions = Array.isArray(positions.body) ? positions.body.length : 0;

    const orders = await transport.get(`${LIVE_ORIGIN}/v2/orders?status=open`);
    result.openOrders = Array.isArray(orders.body) ? orders.body.length : 0;

    const asset = await transport.get(`${LIVE_ORIGIN}/v2/assets/${encodeURIComponent(opts.symbol)}`);
    if (asset.status === 200) {
      const a = asset.body as { tradable?: boolean; min_order_size?: string };
      result.instrumentTradable = Boolean(a.tradable);
      if (!result.instrumentTradable) blockers.push("instrument not tradable");
    } else {
      blockers.push(`asset lookup ${asset.status}`);
    }
  } catch (err) {
    blockers.push(err instanceof Error ? err.message : "preflight failed");
  }

  result.blockers = blockers;
  result.canSubmit = false;
  return result;
}

/**
 * Disabled-by-default single-ticket LIVE executor.
 * Never submits unless both the hard disable flag is cleared AND an explicit
 * CONNECTIVITY_TEST authorization token is present. In this codebase the hard
 * disable remains true; tests use mocks only.
 */
export interface LiveTicketRequest {
  symbol: string;
  side: "buy" | "sell";
  orderType: "market";
  maxNotional: number;
  authorizationExpiry: string;
  category: AuthorizationCategory;
  confirmed: boolean;
}

export interface LiveExecutorState {
  enabled: false;
  submitted: false;
  reason: string;
  clientOrderId: string | null;
}

export function prepareLiveTicket(req: LiveTicketRequest): LiveExecutorState {
  if (req.category !== CONNECTIVITY_TEST) {
    return { enabled: false, submitted: false, reason: "only CONNECTIVITY_TEST category is permitted for this executor", clientOrderId: null };
  }
  if (!req.confirmed) {
    return { enabled: false, submitted: false, reason: "explicit user confirmation of symbol, side, type, max notional and expiry required", clientOrderId: null };
  }
  if (req.maxNotional > 25 || req.maxNotional <= 0) {
    return { enabled: false, submitted: false, reason: "hard-coded maximum exposure for connectivity test is 25 USD", clientOrderId: null };
  }
  if (req.side !== "buy") {
    return { enabled: false, submitted: false, reason: "shorts, leverage and margin are refused; only risk-reducing or entry-buy for connectivity test", clientOrderId: null };
  }
  // Hard disable remains in force. This path never reaches submission.
  return {
    enabled: false,
    submitted: false,
    reason: "LIVE executor is disabled by default. Separate explicit authorization and foreground supervision required before any submission. No order was placed.",
    clientOrderId: null,
  };
}

export function agentRoleStatus(): Record<string, { status: "ACTIVE" | "BLOCKED" | "UNAVAILABLE" | "NOT_APPLICABLE"; inference: false; contribution: string }> {
  return {
    Scout: { status: "ACTIVE", inference: false, contribution: "scan assets (local data)" },
    Vector: { status: "ACTIVE", inference: false, contribution: "technical signals (deterministic)" },
    Atlas: { status: "NOT_APPLICABLE", inference: false, contribution: "equity fundamentals not applicable to crypto connectivity test" },
    Oracle: { status: "ACTIVE", inference: false, contribution: "macro evidence from local dataset" },
    Pulse: { status: "UNAVAILABLE", inference: false, contribution: "news/sentiment source not authorized" },
    Volta: { status: "UNAVAILABLE", inference: false, contribution: "volatility/derivatives dataset unsupported" },
    Bull: { status: "BLOCKED", inference: false, contribution: "paid model billing lock active" },
    Bear: { status: "BLOCKED", inference: false, contribution: "paid model billing lock active" },
    Sigma: { status: "ACTIVE", inference: false, contribution: "data integrity and test constraints" },
    Sentinel: { status: "ACTIVE", inference: false, contribution: "risk veto for connectivity test" },
    Allocator: { status: "ACTIVE", inference: false, contribution: "max notional enforcement" },
    Pilot: { status: "BLOCKED", inference: false, contribution: "LIVE submission disabled" },
    Hermes: { status: "ACTIVE", inference: false, contribution: "journal and reconciliation" },
  };
}
