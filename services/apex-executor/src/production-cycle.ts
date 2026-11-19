/**
 * Proposed production wiring. This file is on the enablement branch only.
 * It is not deployed. fetch is injected so tests can stand in for the network.
 * LIVE hosts are refused before fetch.
 *
 * POST  https://docs.alpaca.markets/us/reference/postorder
 * GET   https://docs.alpaca.markets/us/reference/getorderbyclientorderid
 * GET   https://docs.alpaca.markets/us/reference/getallorders-1
 * DELETE https://docs.alpaca.markets/us/reference/deleteorderbyorderid-1
 * GET   https://docs.alpaca.markets/us/reference/getaccountactivitiesbyactivitytype-1
 */

import { PAPER_TRADING_ORIGIN, assertPaperUrl } from "../../../src/lib/apex/broker/allowlist.ts";
import type { PaperCreds } from "../../../src/lib/apex/broker/paper-read.ts";
import { ORDER_LIST_LIMIT } from "./absence.ts";
import type { PaperWriter } from "./broker-write.ts";
import type { Executor } from "./runtime.ts";
import type { SupervisedOrder } from "./supervised-order.ts";

type FetchImpl = typeof fetch;

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  return JSON.parse(text) as unknown;
}

export function createHttpPaperWriter(fetchImpl: FetchImpl, creds: PaperCreds): PaperWriter {
  const headers = {
    "APCA-API-KEY-ID": creds.keyId,
    "APCA-API-SECRET-KEY": creds.secret,
    "content-type": "application/json",
  };
  async function call(method: "GET" | "POST" | "DELETE", url: string, body?: object): Promise<{ status: number; body: unknown }> {
    const parsed = assertPaperUrl(url);
    if (parsed.hostname !== "paper-api.alpaca.markets") throw new Error("LIVE URL refused");
    const res = await fetchImpl(parsed, { method, headers, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await readJson(res) };
  }
  return {
    networkWrite: "alpaca-http",
    async submit(order) {
      const response = await call("POST", `${PAPER_TRADING_ORIGIN}/v2/orders`, order);
      if (response.status >= 500) return { kind: "unavailable", status: response.status };
      if (response.status === 429) return { kind: "rate_limit" };
      if (response.status >= 400) return { kind: "rejected", status: response.status, body: response.body };
      return { kind: "ack", status: response.status, body: (response.body ?? {}) as Record<string, unknown> };
    },
    async cancel(clientOrderId) {
      const found = await call("GET", `${PAPER_TRADING_ORIGIN}/v2/orders:by_client_order_id?client_order_id=${encodeURIComponent(clientOrderId)}`);
      const id = found.body && typeof found.body === "object" ? (found.body as { id?: unknown }).id : null;
      if (found.status !== 200 || typeof id !== "string") return { kind: "unavailable", status: found.status };
      const response = await call("DELETE", `${PAPER_TRADING_ORIGIN}/v2/orders/${encodeURIComponent(id)}`);
      if (response.status === 204 || response.status === 200) return { kind: "ack", status: response.status, body: { id, client_order_id: clientOrderId, status: "canceled", filled_qty: "0" } };
      if (response.status === 429) return { kind: "rate_limit" };
      return { kind: "unavailable", status: response.status };
    },
    getOrder(clientOrderId) {
      return call("GET", `${PAPER_TRADING_ORIGIN}/v2/orders:by_client_order_id?client_order_id=${encodeURIComponent(clientOrderId)}`);
    },
    getPositions() {
      return call("GET", `${PAPER_TRADING_ORIGIN}/v2/positions`);
    },
    getOpenOrders() {
      return call("GET", `${PAPER_TRADING_ORIGIN}/v2/orders?status=open&limit=${ORDER_LIST_LIMIT}`);
    },
    listOrders(status) {
      return call("GET", `${PAPER_TRADING_ORIGIN}/v2/orders?status=${status}&limit=${ORDER_LIST_LIMIT}`);
    },
    listFills() {
      return call("GET", `${PAPER_TRADING_ORIGIN}/v2/account/activities/FILL?page_size=100`);
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
}): Promise<{ submitted: boolean; reason: string; orderState: string | null }> {
  const writer = createHttpPaperWriter(input.fetchImpl, input.creds);
  await input.exec.recoverInFlight(writer, input.now, async () => {});
  if (!input.order) return { submitted: false, reason: "no supervised order", orderState: null };
  return input.exec.submitPaper(input.order, writer, input.env, input.now);
}
