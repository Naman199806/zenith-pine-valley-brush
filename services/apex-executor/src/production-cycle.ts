/**
 * PAPER HTTP adapter used by the production service.
 * fetch is injected in tests. A simulated fetch is tagged injected and cannot
 * enter the Hermes performance sink. LIVE hosts are refused before fetch.
 * Every request has an AbortController deadline. A POST timeout is ambiguous
 * and is not retried. Cancel is DELETE plus a confirming GET; the body is the
 * broker's, never a fabricated canceled/zero-qty order.
 *
 * POST   https://docs.alpaca.markets/us/reference/postorder
 * GET    https://docs.alpaca.markets/us/reference/getorderbyclientorderid
 * GET    https://docs.alpaca.markets/us/reference/getallorders-1
 * DELETE https://docs.alpaca.markets/us/reference/deleteorderbyorderid-1
 * GET    https://docs.alpaca.markets/us/reference/getaccountactivitiesbyactivitytype-1
 *        page_size, page_token, and direction paginate FILL activities.
 */

import { PAPER_TRADING_ORIGIN, assertPaperUrl } from "../../../src/lib/apex/broker/allowlist.ts";
import type { PaperCreds } from "../../../src/lib/apex/broker/paper-read.ts";
import { FILL_PAGE_LIMIT, ORDER_LIST_LIMIT } from "./absence.ts";
import type { BudgetPurpose } from "./budget.ts";
import type { PaperWriter } from "./broker-write.ts";
import type { Executor } from "./runtime.ts";
import type { SupervisedOrder } from "./supervised-order.ts";

type FetchImpl = typeof fetch;

export interface HttpCallResult {
  status: number;
  body: unknown;
  timeout?: boolean;
  budget?: boolean;
}

export interface HttpPaperOptions {
  fetchImpl: FetchImpl;
  creds: PaperCreds;
  now?: () => number;
  /** One unit of the executor's shared Trading API budget. False means do not fetch. */
  charge?: (purpose: BudgetPurpose) => boolean;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Simulated fetch results stay injected and cannot enter Hermes performance. */
  evidenceChannel?: "alpaca-http" | "injected";
  maxFillPages?: number;
}

const DEFAULT_TIMEOUT_MS = 4_000;
const MAX_TIMEOUT_MS = 10_000;
const CANCEL_CONFIRM_ATTEMPTS = 3;
const DEFAULT_FILL_PAGES = 5;

export function readHttpTimeoutMs(env: NodeJS.ProcessEnv): number {
  const raw = env.APEX_EXECUTOR_HTTP_TIMEOUT_MS;
  if (raw == null || raw.trim() === "") return DEFAULT_TIMEOUT_MS;
  if (!/^\d+$/.test(raw.trim())) return DEFAULT_TIMEOUT_MS;
  const value = Number(raw.trim());
  if (!Number.isInteger(value) || value < 1 || value > MAX_TIMEOUT_MS) return DEFAULT_TIMEOUT_MS;
  return value;
}

export function evidenceChannelFor(fetchImpl: FetchImpl, ambient: FetchImpl = fetch): "alpaca-http" | "injected" {
  return fetchImpl === ambient ? "alpaca-http" : "injected";
}

export function boundedSleep(ms: number): Promise<void> {
  const capped = Math.min(Math.max(0, ms), 2_000);
  return new Promise((resolve) => setTimeout(resolve, capped));
}

function signedBodyProblem(order: object): string | null {
  const row = order as Record<string, unknown>;
  const keys = Object.keys(row).sort();
  const hasNotional = Object.prototype.hasOwnProperty.call(row, "notional");
  const hasQty = Object.prototype.hasOwnProperty.call(row, "qty");
  if (hasNotional === hasQty) return "broker body does not match the signed order";
  const expected = ["client_order_id", "extended_hours", "side", "symbol", "time_in_force", "type", hasNotional ? "notional" : "qty"].sort();
  if (keys.join("|") !== expected.join("|")) return "broker body does not match the signed order";
  if (row.symbol !== "SPY" || row.type !== "market" || row.time_in_force !== "day" || row.extended_hours !== false) return "broker body does not match the signed order";
  if (row.side !== "buy" && row.side !== "sell") return "broker body does not match the signed order";
  if (typeof row.client_order_id !== "string" || !row.client_order_id) return "broker body does not match the signed order";
  if (hasNotional && (row.side !== "buy" || typeof row.notional !== "string")) return "broker body does not match the signed order";
  if (hasQty && (row.side !== "sell" || typeof row.qty !== "string")) return "broker body does not match the signed order";
  return null;
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { malformed: true };
  }
}

export function createHttpPaperWriter(fetchImpl: FetchImpl, creds: PaperCreds, options: Partial<HttpPaperOptions> = {}): PaperWriter & { readonly evidenceChannel: "alpaca-http" | "injected" } {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const charge = options.charge ?? (() => true);
  const sleep = options.sleep ?? boundedSleep;
  const evidenceChannel = options.evidenceChannel ?? evidenceChannelFor(fetchImpl);
  const maxFillPages = options.maxFillPages ?? DEFAULT_FILL_PAGES;
  const headers = {
    "APCA-API-KEY-ID": creds.keyId,
    "APCA-API-SECRET-KEY": creds.secret,
    "content-type": "application/json",
  };
  async function call(method: "GET" | "POST" | "DELETE", url: string, purpose: BudgetPurpose, body?: object): Promise<HttpCallResult> {
    if (!charge(purpose)) return { status: 0, body: null, budget: true };
    const parsed = assertPaperUrl(url);
    if (parsed.hostname !== "paper-api.alpaca.markets") throw new Error("LIVE URL refused");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(parsed, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: controller.signal });
      return { status: res.status, body: await readJson(res) };
    } catch {
      if (controller.signal.aborted) return { status: 0, body: null, timeout: true };
      return { status: 0, body: null, timeout: true };
    } finally {
      clearTimeout(timer);
    }
  }
  const byClient = (clientOrderId: string) => `${PAPER_TRADING_ORIGIN}/v2/orders:by_client_order_id?client_order_id=${encodeURIComponent(clientOrderId)}`;
  return {
    networkWrite: "alpaca-http",
    evidenceChannel,
    async submit(order) {
      const problem = signedBodyProblem(order);
      if (problem) return { kind: "rejected", status: 0, body: problem };
      const purpose: BudgetPurpose = (order as { side?: string }).side === "sell" ? "exit" : "entry";
      const response = await call("POST", `${PAPER_TRADING_ORIGIN}/v2/orders`, purpose, order);
      if (response.timeout) return { kind: "ambiguous", reason: "timeout" };
      if (response.budget) return { kind: "ambiguous", reason: "request budget exceeded" };
      if (response.status >= 500 || response.status === 0) return { kind: "unavailable", status: response.status };
      if (response.status === 429) return { kind: "rate_limit" };
      if (response.status >= 400) return { kind: "rejected", status: response.status, body: response.body };
      return { kind: "ack", status: response.status, body: (response.body ?? {}) as Record<string, unknown> };
    },
    async cancel(clientOrderId) {
      const found = await call("GET", byClient(clientOrderId), "cancel");
      if (found.timeout || found.budget) return { kind: "ambiguous", reason: "cancel lookup unresolved" };
      const id = found.body && typeof found.body === "object" ? (found.body as { id?: unknown }).id : null;
      if (found.status !== 200 || typeof id !== "string") return { kind: "unavailable", status: found.status };
      const deleted = await call("DELETE", `${PAPER_TRADING_ORIGIN}/v2/orders/${encodeURIComponent(id)}`, "cancel");
      if (deleted.timeout || deleted.budget) return { kind: "ambiguous", reason: "cancel write unresolved" };
      if (deleted.status === 429) return { kind: "rate_limit" };
      if (deleted.status !== 204 && deleted.status !== 200) return { kind: "unavailable", status: deleted.status };
      for (let attempt = 0; attempt < CANCEL_CONFIRM_ATTEMPTS; attempt += 1) {
        const again = await call("GET", byClient(clientOrderId), "cancel");
        if (again.timeout || again.budget) return { kind: "ambiguous", reason: "cancel confirmation unresolved" };
        const body = again.body && typeof again.body === "object" ? again.body as Record<string, unknown> : null;
        const status = typeof body?.status === "string" ? body.status : "";
        if (again.status === 200 && body && (status === "canceled" || status === "filled" || status === "expired" || status === "rejected")) {
          return { kind: "ack", status: 200, body };
        }
        if (attempt + 1 < CANCEL_CONFIRM_ATTEMPTS) await sleep(50);
      }
      return { kind: "ambiguous", reason: "cancel not confirmed by the broker" };
    },
    getOrder(clientOrderId, purpose = "recovery") {
      return call("GET", byClient(clientOrderId), purpose);
    },
    getPositions(purpose = "recovery") {
      return call("GET", `${PAPER_TRADING_ORIGIN}/v2/positions`, purpose);
    },
    getOpenOrders(purpose = "recovery") {
      return call("GET", `${PAPER_TRADING_ORIGIN}/v2/orders?status=open&limit=${ORDER_LIST_LIMIT}`, purpose);
    },
    listOrders(status, purpose = "recovery") {
      return call("GET", `${PAPER_TRADING_ORIGIN}/v2/orders?status=${status}&limit=${ORDER_LIST_LIMIT}`, purpose);
    },
    async listFills(purpose = "recovery") {
      const pages: unknown[] = [];
      let token = "";
      for (let page = 0; page < maxFillPages; page += 1) {
        const url = new URL(`${PAPER_TRADING_ORIGIN}/v2/account/activities/FILL`);
        url.searchParams.set("page_size", String(FILL_PAGE_LIMIT));
        url.searchParams.set("direction", "desc");
        if (token) url.searchParams.set("page_token", token);
        const response = await call("GET", url.toString(), purpose);
        if (response.timeout || response.budget || response.status !== 200 || !Array.isArray(response.body)) {
          return { status: 200, body: { activities: pages, next_page_token: token || "incomplete" } };
        }
        pages.push(...response.body);
        if (response.body.length < FILL_PAGE_LIMIT) return { status: 200, body: pages };
        const last = response.body[response.body.length - 1] as { id?: unknown };
        if (typeof last?.id !== "string" || last.id === token) {
          return { status: 200, body: { activities: pages, next_page_token: "incomplete" } };
        }
        token = last.id;
      }
      return { status: 200, body: { activities: pages, next_page_token: token || "incomplete" } };
    },
  };
}

export async function runSupervisedPaperCycle(input: {
  exec: Executor;
  fetchImpl: FetchImpl;
  creds: PaperCreds;
  env: NodeJS.ProcessEnv;
  now: number | (() => number);
  order?: SupervisedOrder | null;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}): Promise<{ submitted: boolean; reason: string; orderState: string | null }> {
  const now = () => (typeof input.now === "function" ? input.now() : input.now);
  const sleep = input.sleep ?? boundedSleep;
  const writer = createHttpPaperWriter(input.fetchImpl, input.creds, {
    now,
    charge: (purpose) => input.exec.spendBudget(now(), 1, purpose),
    sleep,
    timeoutMs: input.timeoutMs,
    evidenceChannel: evidenceChannelFor(input.fetchImpl),
  });
  await input.exec.recoverInFlight(writer, input.now, sleep);
  if (!input.order) return { submitted: false, reason: "no supervised order", orderState: null };
  return input.exec.submitPaper(input.order, writer, input.env, input.now);
}

export async function handleSupervisedInstruction(
  exec: Executor,
  order: SupervisedOrder,
  writer: PaperWriter,
  env: NodeJS.ProcessEnv,
  now: number | (() => number),
): Promise<{ accepted: boolean; submitted: boolean; reason: string; orderState: string | null }> {
  if (!exec.startupIsReady()) return { accepted: false, submitted: false, reason: "startup recovery incomplete", orderState: null };
  const accepted = exec.acceptSupervised(order, now);
  if (!accepted.accepted) return { accepted: false, submitted: false, reason: accepted.reason, orderState: null };
  const sent = await exec.submitPaper(order, writer, env, now);
  return { accepted: true, submitted: sent.submitted, reason: sent.reason, orderState: sent.orderState };
}
