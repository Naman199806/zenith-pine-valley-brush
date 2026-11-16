#!/usr/bin/env node
/**
 * Mock lifecycle only. This does not place an Alpaca order and does not prove a fill.
 * node --experimental-strip-types services/apex-executor/scripts/mock-lifecycle.mjs
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { issueGateProof } from "../../../src/lib/apex/live/executor.ts";
import { signApproval } from "../src/approval.ts";
import { Executor, openMarket, POST_ENABLED } from "../src/runtime.ts";

const SECRET = "mock-operator-secret-32-characters";
const GATE = "mock-gate-secret-32-characters-ok";
process.env.APEX_OPERATOR_SECRET = SECRET;
process.env.APEX_GATE_SECRET = GATE;
const now = Date.parse("2026-11-16T15:00:00Z");

function ticket(over) {
  const base = {
    v: 1,
    source: "OPERATOR_SIGNED",
    clientOrderId: "mock-buy",
    symbol: "SPY",
    side: "buy",
    orderType: "limit",
    timeInForce: "day",
    qty: 0.02,
    limitPrice: 1,
    session: "REGULAR",
    expiresAt: "2099-01-01T00:00:00Z",
    nonce: "mock-buy-nonce",
    category: "CONNECTIVITY_TEST",
    exitAuthorizationId: null,
    linkedEntryId: null,
    ...over,
  };
  const gate = issueGateProof(
    { singleUseId: base.clientOrderId, symbol: base.symbol, side: base.side, qty: base.qty, limitPrice: base.limitPrice },
    { dataIntegrityOk: true, riskOk: true, notional: base.qty * base.limitPrice },
    new Date(now),
    GATE,
  );
  return {
    ...base,
    decisionId: "mock-decision",
    strategyId: "mock",
    strategyVersion: "v1",
    strategyApproved: false,
    evidenceTimestamp: new Date(now).toISOString(),
    sizedNotional: base.qty * base.limitPrice,
    operatorProof: signApproval(base, SECRET),
    gateProof: gate,
  };
}

function broker(book) {
  return async (url) => {
    if (url.includes("by_client_order_id")) {
      const id = new URL(url).searchParams.get("client_order_id");
      const row = book.orders[id];
      return row ? { status: 200, body: row } : { status: 404, body: null };
    }
    if (url.includes("/v2/positions")) return { status: 200, body: book.position };
    if (url.includes("/v2/orders")) return { status: 200, body: book.open };
    return { status: 500, body: null };
  };
}

const dir = mkdtempSync(join(tmpdir(), "apex-mock-"));
const paths = {
  mode: "PAPER",
  postEnabled: false,
  liveCredentialsLoaded: false,
  statePath: join(dir, "state.json"),
  lockPath: join(dir, "writer.lock"),
  inboxPath: join(dir, "inbox.jsonl"),
  journalPath: join(dir, "journal.jsonl"),
  hermesPath: join(dir, "hermes.json"),
  fillsPath: join(dir, "fills.jsonl"),
};
const first = new Executor(paths, { keyId: "PKMOCKKEY1", secret: "mock-paper-secret" });
first.observeMarket(openMarket(now), now);
const buy = ticket();
const accepted = first.accept(buy, now);
const proposed = first.get(buy.clientOrderId);
const book = { orders: { "mock-buy": { filled_qty: "0.01", status: "partially_filled" } }, position: [{ symbol: "SPY", qty: "0.01" }], open: [{ id: "1" }] };
const partial = await first.reconcile(broker(book), buy.clientOrderId);
book.orders["mock-buy"] = { filled_qty: "0.01", status: "canceled" };
book.open = [];
const held = await first.reconcile(broker(book), buy.clientOrderId);
const sell = ticket({ side: "sell", clientOrderId: "mock-sell", nonce: "mock-sell-nonce", qty: 0.01, exitAuthorizationId: "exit-1", linkedEntryId: buy.clientOrderId });
const exit = await first.authorizeExit(buy.clientOrderId, sell, broker(book), now);
const sellRecord = first.get("mock-sell");
book.orders["mock-buy"] = { filled_qty: "0.01", status: "canceled" };
book.position = [];
const buyNotFlat = await first.reconcile(broker(book), buy.clientOrderId);
book.orders["mock-sell"] = { filled_qty: "0.01", status: "filled" };
book.position = [];
book.open = [];
const flat = await first.reconcile(broker(book), "mock-sell");
first.release();
const restarted = new Executor(paths, { keyId: "PKMOCKKEY1", secret: "mock-paper-secret" });
restarted.observeMarket(openMarket(now), now);
const replay = restarted.accept(buy, now);
const again = restarted.get(buy.clientOrderId);
restarted.release();

const report = {
  mock: true,
  realFill: false,
  note: "This demonstration uses a fake broker. It does not prove a real fill.",
  accepted: accepted.state,
  acceptedFilledQty: proposed?.filledQty ?? null,
  acceptedSubmitted: proposed?.submitted ?? null,
  partial: partial.state,
  partialQty: partial.filledQty,
  afterCancel: held.state,
  afterCancelQty: held.filledQty,
  exit: exit.ok,
  sellClientOrderId: sellRecord?.clientOrderId ?? null,
  sellSubmitted: sellRecord?.submitted ?? null,
  buyCanceledWithEmptyBook: buyNotFlat.state,
  flat: flat.state,
  flatClientOrderId: flat.clientOrderId,
  restarted: again?.state ?? null,
  restartedSell: restarted.get("mock-sell")?.state ?? null,
  replay: replay.reason,
  postEnabled: POST_ENABLED,
};
console.log(JSON.stringify(report));
if (accepted.state !== "PROPOSED" || proposed?.submitted !== false || proposed?.filledQty !== 0 || partial.state !== "PARTIAL" || held.state !== "PARTIAL" || held.filledQty !== 0.01 || !exit.ok || sellRecord?.state !== "PROPOSED" || sellRecord.submitted !== false || buyNotFlat.state !== "UNKNOWN" || flat.state !== "FLAT" || flat.clientOrderId !== "mock-sell" || again?.state !== "FLAT" || restarted.get("mock-sell")?.state !== "FLAT" || replay.reason !== "duplicate or replay" || POST_ENABLED !== false) {
  process.exit(1);
}
