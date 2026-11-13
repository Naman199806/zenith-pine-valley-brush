import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_ORIGIN, DATA_STREAM_URL, PAPER_TRADING_ORIGIN, TRADE_STREAM_URL, assertPaperUrl, redactSecrets, tradingOriginGuard } from "./allowlist.ts";
import { cancelPaperOrder, executePaperEntry, orderFromBroker, type BrokerOrder, type Credentials, type Transport } from "./client.ts";
import type { LaunchMode } from "./launch.ts";
import { promoteLaunch } from "./launch.ts";
import { ORB_SYMBOLS, etParts, evaluateOrb, type Bar15 } from "./orb.ts";
import { reconcileLedgers } from "./reconcile.ts";
import { runPaperSafety } from "./safety.ts";
import { sizePaperOrder } from "./risk-paper.ts";
import { transition } from "./machine.ts";
import { parsePaperKeys } from "./keys.ts";
import type { PaperDeskView } from "./view.ts";

const STATE_PATH = join(process.cwd(), ".grok", "paper-state.json");
const KEY_PATH = join(process.cwd(), ".grok", "paper-credentials.json");

interface Persisted {
  launchMode: LaunchMode;
  emergency: boolean;
  autoApproved: boolean;
  reconciliationClean: boolean;
  orders: BrokerOrder[];
  strategyQty: { symbol: string; qty: number }[];
  events: { ts: string; text: string }[];
  lastAuthenticatedAt: string | null;
}

function emptyState(): Persisted {
  return { launchMode: "MONITORING", emergency: false, autoApproved: false, reconciliationClean: false, orders: [], strategyQty: [], events: [], lastAuthenticatedAt: null };
}

function loadState(): Persisted {
  try {
    const parsed = JSON.parse(readFileSync(STATE_PATH, "utf8")) as Persisted;
    if (parsed.launchMode !== "MONITORING" && parsed.launchMode !== "PAPER_MANUAL" && parsed.launchMode !== "PAPER_AUTO") return emptyState();
    return { ...emptyState(), ...parsed, orders: Array.isArray(parsed.orders) ? parsed.orders : [] };
  } catch {
    return emptyState();
  }
}

function saveState(state: Persisted): void {
  mkdirSync(join(process.cwd(), ".grok"), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function storedCredentials(): Credentials | null {
  if (process.env.APEX_PAPER_KEY_FILE === "off") return null;
  try {
    const parsed = JSON.parse(readFileSync(KEY_PATH, "utf8")) as { keyId?: unknown; secret?: unknown };
    const checked = parsePaperKeys(parsed.keyId, parsed.secret);
    return checked.ok ? { keyId: checked.keyId, secret: checked.secret } : null;
  } catch {
    return null;
  }
}

function credentials(): Credentials | null {
  const fromEnv = parsePaperKeys(process.env.APCA_API_KEY_ID, process.env.APCA_API_SECRET_KEY);
  if (fromEnv.ok) return { keyId: fromEnv.keyId, secret: fromEnv.secret };
  return storedCredentials();
}

export function paperStreamCredentials(): Credentials | null {
  return credentials();
}

function storeCredentials(keyId: string, secret: string): void {
  mkdirSync(join(process.cwd(), ".grok"), { recursive: true });
  writeFileSync(KEY_PATH, JSON.stringify({ keyId, secret }), { mode: 0o600 });
}

function fetchTransport(secrets: string[]): Transport {
  return {
    async call({ method, url, body, headers }) {
      assertPaperUrl(url);
      const response = await fetch(url, {
        method,
        headers: { accept: "application/json", "content-type": "application/json", ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
      });
      const text = await response.text();
      let parsed: unknown = null;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = { message: "unparsed response" };
        }
      }
      return { status: response.status, body: JSON.parse(redactSecrets(JSON.stringify(parsed), secrets)) };
    },
  };
}

function event(state: Persisted, text: string): void {
  state.events = [...state.events, { ts: new Date().toISOString(), text }].slice(-30);
}

export async function readPaperDesk(): Promise<PaperDeskView> {
  const state = loadState();
  const safety = runPaperSafety();
  const creds = credentials();
  const guard = tradingOriginGuard(process.env.APCA_API_BASE_URL);
  const secrets = creds ? [creds.keyId, creds.secret] : [];
  const base: PaperDeskView = {
    launchMode: state.launchMode,
    liveSelectable: false,
    connected: false,
    keysStored: Boolean(creds),
    paperAccountConfirmed: false,
    reason: creds ? "Paper credentials are present. Authentication has not succeeded yet." : "No paper key is saved yet. Enter it in Paper key ID and Paper secret. No broker call was authenticated.",
    host: "paper-api.alpaca.markets",
    dataFeed: "unavailable",
    dataNote: "No market-data request was authenticated.",
    streamNote: "Trade and IEX sockets are not open.",
    clock: null,
    lastDataTs: null,
    account: null,
    positions: [],
    orders: state.orders,
    signals: [],
    riskNotes: guard.reason ? [guard.reason] : [],
    events: state.events,
    reconciliationClean: false,
    reconciliationNotes: [],
    emergency: state.emergency,
    safetyPassed: safety.passed,
    safetyFailed: safety.failed,
    dayDrawdown: null,
    minuteEt: null,
    proposal: null,
  };
  if (!creds) return base;
  const transport = fetchTransport(secrets);
  try {
    const accountRes = await transport.call({ method: "GET", url: `${PAPER_TRADING_ORIGIN}/v2/account`, headers: auth(creds) });
    const clockRes = await transport.call({ method: "GET", url: `${PAPER_TRADING_ORIGIN}/v2/clock`, headers: auth(creds) });
    const posRes = await transport.call({ method: "GET", url: `${PAPER_TRADING_ORIGIN}/v2/positions`, headers: auth(creds) });
    const ordRes = await transport.call({ method: "GET", url: `${PAPER_TRADING_ORIGIN}/v2/orders?status=all&limit=50`, headers: auth(creds) });
    if (accountRes.status !== 200) {
      base.reason = `Paper account request returned ${accountRes.status}. This is not a confirmed paper session.`;
      event(state, base.reason);
      saveState(state);
      return { ...base, events: state.events };
    }
    const account = parseAccount(accountRes.body);
    if (!account) {
      base.reason = "Paper host returned a body without equity. It was not treated as an account.";
      saveState(state);
      return { ...base, events: state.events };
    }
    const clock = parseClock(clockRes.body);
    const minuteEt = clock ? etParts(clock.timestamp).minutes : null;
    const dayDrawdown = account.lastEquity > 0 && account.equityCents < account.lastEquity ? (account.lastEquity - account.equityCents) / account.lastEquity : 0;
    const positions = posRes.status === 200 ? parsePositions(posRes.body) : [];
    const brokerOrders = ordRes.status === 200 ? parseOrders(ordRes.body) : [];
    const recovered = recover(state.orders, brokerOrders);
    const brokerLines = positions.map((row) => ({ symbol: row.symbol, qty: Number(row.qty) }));
    const compared = reconcileLedgers(state.strategyQty, brokerLines);
    state.reconciliationClean = posRes.status === 200 && compared.clean;
    state.lastAuthenticatedAt = new Date().toISOString();
    state.orders = recovered;
    state.strategyQty = filledQtyBySymbol(recovered);
    event(state, "Authenticated paper account read.");
    let signals = [] as PaperDeskView["signals"];
    let dataFeed: PaperDeskView["dataFeed"] = "unavailable";
    let dataNote = "IEX bars were not authorized.";
    let lastDataTs: string | null = clock?.timestamp ?? null;
    if (clock?.isOpen) {
      const barsUrl = `${DATA_ORIGIN}/v2/stocks/bars?symbols=${ORB_SYMBOLS.join(",")}&timeframe=15Min&limit=8&adjustment=raw&feed=iex&sort=desc`;
      const quoteUrl = `${DATA_ORIGIN}/v2/stocks/quotes/latest?symbols=${ORB_SYMBOLS.join(",")}&feed=iex`;
      assertPaperUrl(barsUrl);
      assertPaperUrl(quoteUrl);
      const barsRes = await transport.call({ method: "GET", url: barsUrl, headers: auth(creds) });
      const quoteRes = await transport.call({ method: "GET", url: quoteUrl, headers: auth(creds) });
      if (barsRes.status === 200 && quoteRes.status === 200) {
        dataFeed = "iex";
        dataNote = "IEX 15-minute bars and latest quotes. Not the consolidated tape. Unadjusted.";
        signals = buildSignals(barsRes.body, quoteRes.body, clock.timestamp);
        lastDataTs = clock.timestamp;
      } else {
        dataNote = `Market data returned ${barsRes.status}/${quoteRes.status}. No signal was generated.`;
      }
    } else if (clock) {
      dataNote = "The paper clock says the market is closed. No entry signal was generated.";
    }
    saveState(state);
    return {
      ...base,
      connected: true,
      paperAccountConfirmed: true,
      reason: account.blocked ? "Paper account is authenticated but blocked at the broker." : "Authenticated against the paper host.",
      dataFeed,
      dataNote,
      streamNote: `Monitor process may open ${DATA_STREAM_URL} and ${TRADE_STREAM_URL}. This read used REST.`,
      clock,
      lastDataTs,
      account,
      positions,
      orders: state.orders,
      signals,
      riskNotes: [...base.riskNotes, ...compared.notes],
      events: state.events,
      reconciliationClean: state.reconciliationClean,
      reconciliationNotes: compared.notes,
      dayDrawdown,
      minuteEt,
    };
  } catch (error) {
    const reason = redactSecrets(error instanceof Error ? error.message : "paper read failed", secrets);
    event(state, reason);
    saveState(state);
    return { ...base, reason, events: state.events };
  }
}

function auth(creds: Credentials): Record<string, string> {
  return { "APCA-API-KEY-ID": creds.keyId, "APCA-API-SECRET-KEY": creds.secret };
}

function parseAccount(body: unknown): (NonNullable<PaperDeskView["account"]> & { equityCents: number; lastEquity: number }) | null {
  const row = body as { equity?: unknown; cash?: unknown; buying_power?: unknown; status?: unknown; last_equity?: unknown; account_blocked?: boolean; trading_blocked?: boolean };
  if (!row || typeof row.equity !== "string" || typeof row.cash !== "string") return null;
  const equityCents = Math.round(Number(row.equity) * 100);
  const lastEquity = Math.round(Number(row.last_equity ?? row.equity) * 100);
  if (!Number.isFinite(equityCents)) return null;
  return {
    equity: row.equity,
    cash: row.cash,
    buyingPower: typeof row.buying_power === "string" ? row.buying_power : "",
    status: typeof row.status === "string" ? row.status : "",
    blocked: Boolean(row.account_blocked || row.trading_blocked),
    equityCents,
    lastEquity: Number.isFinite(lastEquity) ? lastEquity : equityCents,
  };
}

function parseClock(body: unknown): PaperDeskView["clock"] {
  const row = body as { timestamp?: unknown; is_open?: unknown };
  if (!row || typeof row.timestamp !== "string" || typeof row.is_open !== "boolean") return null;
  return { timestamp: row.timestamp, isOpen: row.is_open };
}

function parsePositions(body: unknown) {
  if (!Array.isArray(body)) return [];
  return body.flatMap((row) => {
    const item = row as { symbol?: unknown; qty?: unknown; avg_entry_price?: unknown; unrealized_pl?: unknown; market_value?: unknown };
    if (typeof item.symbol !== "string" || typeof item.qty !== "string") return [];
    return [{ symbol: item.symbol, qty: item.qty, avgEntry: String(item.avg_entry_price ?? ""), unrealizedPl: String(item.unrealized_pl ?? ""), marketValue: String(item.market_value ?? "") }];
  });
}

function parseOrders(body: unknown): BrokerOrder[] {
  if (!Array.isArray(body)) return [];
  return body.map((row) => orderFromBroker(row));
}

function filledQtyBySymbol(orders: BrokerOrder[]): { symbol: string; qty: number }[] {
  const qty = new Map<string, number>();
  for (const order of orders) {
    if (!order.clientOrderId.startsWith("ax")) continue;
    const signed = order.side === "sell" ? -order.filledQty : order.filledQty;
    qty.set(order.symbol, (qty.get(order.symbol) ?? 0) + signed);
  }
  return [...qty.entries()].map(([symbol, size]) => ({ symbol, qty: size }));
}

function recover(local: BrokerOrder[], remote: BrokerOrder[]): BrokerOrder[] {
  const byClient = new Map(remote.filter((order) => order.clientOrderId).map((order) => [order.clientOrderId, order]));
  const seen = new Set<string>();
  const merged = local.map((order) => {
    const found = byClient.get(order.clientOrderId);
    if (!found) return order;
    seen.add(order.clientOrderId);
    try {
      const state = order.state === found.state ? order.state : transition(order.state, found.state);
      return { ...found, state, theoretical: false };
    } catch {
      return { ...order, state: "unknown_pending_reconciliation" as const, reason: "Local state and the broker disagree. No resubmit." };
    }
  });
  for (const order of remote) {
    if (order.clientOrderId.startsWith("ax") && !seen.has(order.clientOrderId)) merged.push(order);
  }
  return merged;
}

function buildSignals(barsBody: unknown, quoteBody: unknown, nowIso: string) {
  const bars = (barsBody as { bars?: Record<string, Bar15[]> }).bars ?? {};
  const quotes = (quoteBody as { quotes?: Record<string, { bp?: number; ap?: number; t?: string }> }).quotes ?? {};
  return ORB_SYMBOLS.map((symbol) => {
    const quote = quotes[symbol];
    const snap = quote && typeof quote.bp === "number" && typeof quote.ap === "number" && typeof quote.t === "string" ? { bid: quote.bp, ask: quote.ap, ts: quote.t } : null;
    return evaluateOrb(symbol, bars[symbol] ?? [], nowIso, snap, "raw");
  });
}

export async function paperAction(action: string, extra: { symbol?: string; operatorConfirmed?: boolean; phrase?: string; keyId?: string; secret?: string }): Promise<PaperDeskView> {
  const state = loadState();
  const safety = runPaperSafety();
  const creds = credentials();
  const guard = tradingOriginGuard(process.env.APCA_API_BASE_URL);
  if (action === "store-keys") {
    const parsed = parsePaperKeys(extra.keyId, extra.secret);
    if (!parsed.ok) {
      event(state, parsed.reason);
      saveState(state);
      const refused = await readPaperDesk();
      refused.reason = parsed.reason;
      return refused;
    }
    storeCredentials(parsed.keyId, parsed.secret);
    event(state, "Paper key stored on the server. The secret is not written to the event log.");
    saveState(state);
    return readPaperDesk();
  }
  if (action === "disarm") {
    state.launchMode = "MONITORING";
    event(state, "Operator returned the session to monitoring.");
    saveState(state);
    return readPaperDesk();
  }
  if (action === "emergency") {
    state.emergency = true;
    state.launchMode = "MONITORING";
    event(state, "Emergency stop requested. Open orders are cancel-requested. Fills are not guaranteed, and the book is not marked flat.");
    if (creds && !guard.blockOrders) {
      const transport = fetchTransport([creds.keyId, creds.secret]);
      const next: BrokerOrder[] = [];
      for (const order of state.orders) {
        next.push(await cancelPaperOrder(transport, creds, order));
      }
      state.orders = next;
    }
    saveState(state);
    return readPaperDesk();
  }
  if (action === "arm-manual" || action === "approve-auto") {
    const desk = await readPaperDesk();
    const facts = {
      safetyPassed: safety.passed,
      paperAccountConfirmed: desk.paperAccountConfirmed,
      reconciliationClean: desk.reconciliationClean,
      operatorApprovedAuto: action === "approve-auto" && extra.phrase === "APPROVE PAPER AUTO",
    };
    const next = promoteLaunch(loadState().launchMode, action === "arm-manual" ? "PAPER_MANUAL" : "PAPER_AUTO", facts);
    const fresh = loadState();
    if (next.ok && action === "approve-auto") fresh.autoApproved = true;
    fresh.launchMode = next.mode;
    event(fresh, next.ok ? `Launch mode is ${next.mode}.` : next.reasons.join(" "));
    saveState(fresh);
    return readPaperDesk();
  }
  if (action === "cancel") {
    if (!creds || !extra.symbol) {
      event(state, "Cancel refused. No confirmed paper key or no client order id.");
      saveState(state);
      return readPaperDesk();
    }
    const target = state.orders.find((row) => row.clientOrderId === extra.symbol);
    if (!target) {
      event(state, "Cancel refused. That client order id is not in this session.");
      saveState(state);
      return readPaperDesk();
    }
    const transport = fetchTransport([creds.keyId, creds.secret]);
    const next = await cancelPaperOrder(transport, creds, target);
    state.orders = state.orders.map((row) => (row.clientOrderId === next.clientOrderId ? next : row));
    event(state, `Cancel ${next.clientOrderId} is ${next.state}. ${next.reason}`);
    saveState(state);
    return readPaperDesk();
  }
  if (action === "reconcile") {
    event(state, "Operator requested a fresh paper reconciliation.");
    saveState(state);
    return readPaperDesk();
  }
  if (action === "propose-smoke") {
    const current = await readPaperDesk();
    if (!creds || !current.paperAccountConfirmed) {
      event(loadState(), "Smoke proposal refused. No confirmed paper account.");
      saveState(loadState());
      return readPaperDesk();
    }
    const reasons: string[] = [];
    if (!current.clock?.isOpen) reasons.push("Market is closed. No order will be submitted.");
    const quoteUrl = `${DATA_ORIGIN}/v2/stocks/quotes/latest?symbols=SPY&feed=iex`;
    assertPaperUrl(quoteUrl);
    const transport = fetchTransport([creds.keyId, creds.secret]);
    const quoteRes = await transport.call({ method: "GET", url: quoteUrl, headers: auth(creds) });
    const quote = (quoteRes.body as { quotes?: Record<string, { bp?: number; ap?: number; t?: string }> })?.quotes?.SPY;
    if (quoteRes.status !== 200 || !quote || typeof quote.ap !== "number" || typeof quote.bp !== "number" || typeof quote.t !== "string") {
      reasons.push("Fresh SPY quote was not returned.");
    }
    const ask = quote?.ap ?? 0;
    const bid = quote?.bp ?? 0;
    const spreadBps = ask > 0 ? ((ask - bid) / ask) * 10_000 : 999;
    if (spreadBps > 10) reasons.push(`Spread is ${spreadBps.toFixed(1)} bps, wider than 10.`);
    const quoteAgeMs = quote?.t ? Date.now() - Date.parse(quote.t) : 999_999;
    if (quoteAgeMs > 30_000) reasons.push("Quote is older than 30 seconds.");
    const entryCents = Math.round(ask * 100);
    const stopCents = entryCents - 100;
    const equityCents = Math.round(Number(current.account?.equity ?? "0") * 100);
    const cashCents = Math.round(Number(current.account?.cash ?? "0") * 100);
    const sized = sizePaperOrder({
      equityCents,
      cashCents,
      entryPriceCents: entryCents,
      stopPriceCents: stopCents,
      openPositions: current.positions.length,
      entriesToday: 0,
      dayDrawdown: current.dayDrawdown ?? 1,
      minuteEt: current.minuteEt ?? 16 * 60,
      side: "buy",
      dataOk: quoteRes.status === 200 && spreadBps <= 10,
      emergency: loadState().emergency || Boolean(current.account?.blocked),
      duplicate: false,
      closing: false,
    });
    if (sized.qty < 1) reasons.push(...sized.reasons);
    if (cashCents < entryCents) reasons.push("Cash does not cover one share.");
    const now = current.clock?.timestamp ?? new Date().toISOString();
    const id = `ax${now.replace(/[-:TZ.]/g, "").slice(0, 14)}SPYS`.replace(/[^A-Za-z0-9]/g, "").slice(0, 48);
    const proposal = {
      symbol: "SPY",
      side: "buy" as const,
      qty: 1,
      clientOrderId: id,
      entryPriceCents: entryCents,
      stopPriceCents: stopCents,
      notionalCents: entryCents,
      cashCents,
      marketOpen: Boolean(current.clock?.isOpen),
      eligible: reasons.length === 0 && sized.qty >= 1,
      reasons,
    };
    const fresh = loadState();
    event(fresh, proposal.eligible ? `Smoke proposal ${id} is ready. One SPY share. Operator confirmation still required.` : `Smoke proposal refused. ${reasons.join(" ")}`);
    saveState(fresh);
    const desk = await readPaperDesk();
    return { ...desk, proposal };
  }
  if (action === "propose-entry") {
    const current = await readPaperDesk();
    if (!creds || !current.paperAccountConfirmed || !extra.symbol) {
      event(loadState(), "Proposal refused. No confirmed paper account or no symbol.");
      saveState(loadState());
      return readPaperDesk();
    }
    const signal = current.signals.find((row) => row.symbol === extra.symbol && row.action === "enter_long");
    const reasons: string[] = [];
    if (!current.clock?.isOpen) reasons.push("Market is closed. No order will be submitted.");
    if (current.dataFeed !== "iex") reasons.push("Fresh IEX bars are not available.");
    if (!signal || signal.stop === null || signal.close === null) reasons.push("No eligible entry signal for that symbol.");
    const equityCents = Math.round(Number(current.account?.equity ?? "0") * 100);
    const cashCents = Math.round(Number(current.account?.cash ?? "0") * 100);
    const entry = signal?.close ?? 0;
    const stop = signal?.stop ?? 0;
    const sized = sizePaperOrder({
      equityCents,
      cashCents,
      entryPriceCents: Math.round(entry * 100),
      stopPriceCents: Math.round(stop * 100),
      openPositions: current.positions.length,
      entriesToday: loadState().orders.filter((row) => row.side === "buy" && row.state !== "rejected").length,
      dayDrawdown: current.dayDrawdown ?? 1,
      minuteEt: current.minuteEt ?? 16 * 60,
      side: "buy",
      dataOk: current.dataFeed === "iex",
      emergency: loadState().emergency || Boolean(current.account?.blocked),
      duplicate: false,
      closing: false,
    });
    if (sized.qty < 1) reasons.push(...sized.reasons, "Risk sized the order to zero.");
    if (cashCents < sized.qty * Math.round(entry * 100)) reasons.push("Available cash is below the proposed notional.");
    const now = current.clock?.timestamp ?? new Date().toISOString();
    const id = `ax${now.replace(/[-:TZ.]/g, "").slice(0, 14)}${extra.symbol}P`.replace(/[^A-Za-z0-9]/g, "").slice(0, 48);
    const proposal = {
      symbol: extra.symbol,
      side: "buy" as const,
      qty: sized.qty,
      clientOrderId: id,
      entryPriceCents: Math.round(entry * 100),
      stopPriceCents: Math.round(stop * 100),
      notionalCents: sized.qty * Math.round(entry * 100),
      cashCents,
      marketOpen: Boolean(current.clock?.isOpen),
      eligible: reasons.length === 0 && sized.qty > 0,
      reasons,
    };
    const fresh = loadState();
    event(fresh, proposal.eligible ? `Proposal ${id} is ready for operator approval.` : `Proposal refused. ${reasons.join(" ")}`);
    saveState(fresh);
    const desk = await readPaperDesk();
    return { ...desk, proposal };
  }
  if (action === "confirm-entry") {
    const current = await readPaperDesk();
    if (!creds || !current.paperAccountConfirmed || guard.blockOrders || !extra.operatorConfirmed || !extra.symbol) {
      event(loadState(), "Entry refused. Monitoring, missing confirmation, or no confirmed paper account.");
      const refused = loadState();
      saveState(refused);
      return readPaperDesk();
    }
    const signal = current.signals.find((row) => row.symbol === extra.symbol && row.action === "enter_long");
    const fresh = loadState();
    if (!signal || signal.stop === null || signal.close === null) {
      event(fresh, "No entry signal for that symbol. Nothing was sent.");
      saveState(fresh);
      return readPaperDesk();
    }
    if (!current.clock?.isOpen) {
      event(fresh, "Market is closed. The operator confirmation was recorded and no order was sent.");
      saveState(fresh);
      return readPaperDesk();
    }
    const equityCents = Math.round(Number(current.account?.equity ?? "0") * 100);
    const cashCents = Math.round(Number(current.account?.cash ?? "0") * 100);
    const transport = fetchTransport([creds.keyId, creds.secret]);
    const order = await executePaperEntry(
      transport,
      creds,
      {
        symbol: extra.symbol,
        side: "buy",
        entryPriceCents: Math.round(signal.close * 100),
        stopPriceCents: Math.round(signal.stop * 100),
        equityCents,
        cashCents,
        openPositions: current.positions.length,
        entriesToday: fresh.orders.filter((row) => row.side === "buy" && row.state !== "rejected").length,
        dayDrawdown: current.dayDrawdown ?? 1,
        minuteEt: current.minuteEt ?? 16 * 60,
        dataOk: current.dataFeed === "iex",
        emergency: fresh.emergency || Boolean(current.account?.blocked),
        duplicate: fresh.orders.some((row) => row.symbol === extra.symbol && !["canceled", "rejected", "expired", "filled"].includes(row.state)),
        closing: false,
        closeQty: 0,
        mode: fresh.launchMode,
        operatorConfirmed: true,
        autoApproved: fresh.autoApproved,
        blockOrders: guard.blockOrders,
      },
      current.clock?.timestamp ?? new Date().toISOString(),
      String(fresh.orders.length + 1),
    );
    fresh.orders = [...fresh.orders, order];
    event(fresh, `Paper entry ${order.clientOrderId} is ${order.state}. ${order.reason}`);
    saveState(fresh);
    return readPaperDesk();
  }
  return readPaperDesk();
}

export function nextDelayMs(attempt: number): number {
  return Math.min(30_000, 1_000 * 2 ** Math.min(Math.max(attempt, 0), 5));
}

export async function openPaperStreams(creds: Credentials, onNote: (text: string) => void, signal: AbortSignal): Promise<void> {
  const sockets: WebSocket[] = [];
  const connect = (url: string, hello: unknown) => {
    assertPaperUrl(url);
    let attempt = 0;
    const run = () => {
      if (signal.aborted) return;
      const ws = new WebSocket(url);
      sockets.push(ws);
      ws.addEventListener("open", () => {
        attempt = 0;
        ws.send(JSON.stringify(hello));
        onNote(`Socket open ${new URL(url).hostname}${new URL(url).pathname}`);
      });
      ws.addEventListener("message", (ev) => {
        const text = redactSecrets(String(ev.data), [creds.secret, creds.keyId]);
        onNote(text.slice(0, 180));
        if (text.includes("authenticated") && url.includes("stream.data")) {
          ws.send(JSON.stringify({ action: "subscribe", bars: ["SPY", "QQQ", "IWM", "GLD", "TLT"] }));
        }
        if (text.includes("authenticated") && url.includes("paper-api")) {
          ws.send(JSON.stringify({ action: "listen", data: { streams: ["trade_updates"] } }));
        }
      });
      ws.addEventListener("close", () => {
        if (signal.aborted) return;
        attempt += 1;
        setTimeout(run, nextDelayMs(attempt));
      });
      ws.addEventListener("error", () => {
        onNote(`Socket error ${new URL(url).hostname}. Reconnecting.`);
      });
    };
    run();
  };
  connect(DATA_STREAM_URL, { action: "auth", key: creds.keyId, secret: creds.secret });
  connect(TRADE_STREAM_URL, { action: "authenticate", data: { key_id: creds.keyId, secret_key: creds.secret } });
  signal.addEventListener("abort", () => {
    for (const ws of sockets) ws.close();
  });
}

export function clearPaperStateForTests(): void {
  if (existsSync(STATE_PATH)) writeFileSync(STATE_PATH, JSON.stringify(emptyState()));
}
