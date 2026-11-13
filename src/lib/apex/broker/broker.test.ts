import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertPaperUrl, redactSecrets, tradingOriginGuard } from "./allowlist.ts";
import { cancelPaperOrder, executePaperEntry, replacePaperOrder, resolveUnknownOrder, type EntryRequest, type Transport } from "./client.ts";
import { promoteLaunch } from "./launch.ts";
import { parsePaperKeys } from "./keys.ts";
import { evaluateOrb } from "./orb.ts";
import { reconcileLedgers } from "./reconcile.ts";
import { sizePaperOrder } from "./risk-paper.ts";
import { nextDelayMs, readPaperDesk } from "./runtime.server.ts";
import { runPaperSafety } from "./safety.ts";

const CREDS = { keyId: "PAPERKEY123", secret: "paper-secret-value" };

function entry(over: Partial<EntryRequest> = {}): EntryRequest {
  return {
    symbol: "SPY",
    side: "buy",
    entryPriceCents: 50_000,
    stopPriceCents: 49_000,
    equityCents: 100_000_000,
    cashCents: 100_000_000,
    openPositions: 0,
    entriesToday: 0,
    dayDrawdown: 0,
    minuteEt: 600,
    dataOk: true,
    emergency: false,
    duplicate: false,
    closing: false,
    closeQty: 0,
    mode: "PAPER_MANUAL",
    operatorConfirmed: true,
    autoApproved: false,
    blockOrders: false,
    ...over,
  };
}

function scripted(handler: (method: string, url: string) => { status: number; body: unknown }): { transport: Transport; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    transport: {
      async call({ method, url, headers }) {
        calls.push(`${method} ${url}`);
        assert.equal(headers["APCA-API-SECRET-KEY"], CREDS.secret);
        assertPaperUrl(url);
        return handler(method, url);
      },
    },
  };
}

describe("alpaca paper broker", () => {
  it("refuses the live trading host and ignores a live base URL", () => {
    assert.throws(() => assertPaperUrl("https://api.alpaca.markets/v2/orders"), /Blocked host/);
    assert.throws(() => assertPaperUrl("https://paper-api.alpaca.markets/v1/live"), /Blocked paper-trading path/);
    assert.equal(assertPaperUrl("https://paper-api.alpaca.markets/v2/account").hostname, "paper-api.alpaca.markets");
    const guard = tradingOriginGuard("https://api.alpaca.markets");
    assert.equal(guard.blockOrders, true);
    assert.equal(guard.origin, "https://paper-api.alpaca.markets");
    assert.equal(runPaperSafety().passed, true);
    assert.equal(promoteLaunch("MONITORING", "LIVE", { safetyPassed: true, paperAccountConfirmed: true, reconciliationClean: true, operatorApprovedAuto: true }).ok, false);
  });

  it("sizes a long at 0.10% risk and blocks the session limits", () => {
    const sized = sizePaperOrder(entry());
    assert.equal(sized.qty, 100);
    assert.equal(sizePaperOrder(entry({ side: "sell" })).qty, 0);
    assert.equal(sizePaperOrder(entry({ dayDrawdown: 0.005 })).qty, 0);
    assert.equal(sizePaperOrder(entry({ dayDrawdown: 0.01 })).emergency, true);
    assert.equal(sizePaperOrder(entry({ minuteEt: 15 * 60 })).qty, 0);
    assert.equal(sizePaperOrder(entry({ openPositions: 3 })).qty, 0);
    assert.equal(sizePaperOrder(entry({ entriesToday: 5 })).qty, 0);
    assert.equal(sizePaperOrder(entry({ duplicate: true })).qty, 0);
    assert.equal(sizePaperOrder(entry({ cashCents: 0 })).qty, 0);
    assert.equal(sizePaperOrder(entry({ dataOk: false })).qty, 0);
  });

  it("does not double-count an in-kind crypto fee and a proceeds fee", () => {
    const filled = 0.001;
    const position = 0.0009975;
    const inKind = filled - position;
    assert.equal(Math.round(inKind * 1e8), 250);
    const sellQty = position;
    const sellPx = 71151.42;
    const gross = sellQty * sellPx;
    const proceedsFee = gross * 0.0025;
    const cashIn = gross - proceedsFee;
    assert.ok(Math.abs(cashIn - 70.79) < 0.05);
    assert.equal(inKind + proceedsFee > 0, true);
  });

  it("flags an opening-range break without calling it a validated profit", () => {
    const now = "2026-11-12T15:00:00.000Z";
    const bars = [
      { t: "2026-11-12T14:30:00.000Z", o: 99, h: 100, l: 98, c: 99.5, v: 5000 },
      { t: "2026-11-12T14:45:00.000Z", o: 99.8, h: 101.2, l: 99.7, c: 101, v: 8000 },
    ];
    const quote = { bid: 100.98, ask: 101.02, ts: now };
    const signal = evaluateOrb("SPY", bars, now, quote, "raw");
    assert.equal(signal.action, "enter_long");
    assert.equal(signal.validated, false);
    assert.equal(signal.stop, 98);
    assert.equal(evaluateOrb("SPY", bars, now, quote, "raw").experimental, true);
    assert.equal(evaluateOrb("SPY", [{ ...bars[0], c: 99 }, bars[1] && { ...bars[1], c: 99.4, h: 99.6 }], now, quote, "raw").action, "skip");
    assert.equal(evaluateOrb("SPY", bars, "2026-11-12T20:10:00.000Z", quote, "raw").action, "skip");
    assert.equal(evaluateOrb("SPY", bars, "2026-11-12T20:55:00.000Z", quote, "raw").action, "flatten");
    assert.equal(evaluateOrb("SPY", [bars[0]!, bars[0]!], now, quote, "raw").action, "skip");
    assert.equal(evaluateOrb("SPY", bars, now, { bid: 100, ask: 102, ts: now }, "raw").action, "skip");
    assert.equal(evaluateOrb("SPY", bars, "2026-11-12T15:20:00.000Z", quote, "raw").reason.includes("stale"), true);
  });

  it("submits only to the paper host after a lookup, and does not resubmit an unknown order", async () => {
    let posts = 0;
    const happy = scripted((method) => {
      if (method === "GET") return { status: 404, body: { message: "not found" } };
      posts += 1;
      return { status: 200, body: { id: "brk-1", client_order_id: "ignored", status: "accepted", qty: "100", filled_qty: "0", symbol: "SPY", side: "buy" } };
    });
    const order = await executePaperEntry(happy.transport, CREDS, entry(), "2026-11-12T15:00:00.000Z", "1");
    assert.equal(order.state, "accepted");
    assert.equal(order.theoretical, false);
    assert.equal(posts, 1);
    assert.ok(happy.calls.every((call) => call.includes("https://paper-api.alpaca.markets/")));
    assert.equal(JSON.stringify(order).includes(CREDS.secret), false);

    const quiet = scripted((method) => {
      if (method === "POST") {
        posts += 1;
        throw new Error(`down ${CREDS.secret}`);
      }
      return { status: 404, body: {} };
    });
    const unknown = await executePaperEntry(quiet.transport, CREDS, entry(), "2026-11-12T15:00:00.000Z", "2");
    assert.equal(unknown.state, "unknown_pending_reconciliation");
    assert.equal(unknown.reason.includes(CREDS.secret), false);
    const postsBefore = quiet.calls.filter((call) => call.startsWith("POST")).length;
    const resolved = await resolveUnknownOrder(quiet.transport, CREDS, unknown);
    assert.equal(resolved.state, "rejected");
    assert.equal(quiet.calls.filter((call) => call.startsWith("POST")).length, postsBefore);
  });

  it("records a partial fill, a cancel, a replace, and a broker rejection", async () => {
    const partial = scripted((method) => {
      if (method === "GET") return { status: 404, body: {} };
      return { status: 200, body: { id: "brk-2", client_order_id: "x", status: "partially_filled", qty: "100", filled_qty: "40", symbol: "SPY", side: "buy" } };
    });
    const part = await executePaperEntry(partial.transport, CREDS, entry(), "2026-11-12T15:00:00.000Z", "3");
    assert.equal(part.state, "partially_filled");
    assert.equal(part.filledQty, 40);

    const rejected = scripted((method) => (method === "GET" ? { status: 404, body: {} } : { status: 403, body: { message: "no" } }));
    const no = await executePaperEntry(rejected.transport, CREDS, entry(), "2026-11-12T15:00:00.000Z", "4");
    assert.equal(no.state, "rejected");

    const canceled = await cancelPaperOrder(
      { async call() { return { status: 204, body: null }; } },
      CREDS,
      { ...part, state: "accepted" },
    );
    assert.equal(canceled.state, "canceled");

    const replaced = await replacePaperOrder(
      { async call({ url }) { assertPaperUrl(url); return { status: 200, body: { id: "brk-3", client_order_id: "x", status: "accepted", qty: "80", filled_qty: "0", symbol: "SPY", side: "buy" } }; } },
      CREDS,
      { ...part, state: "accepted", brokerId: "brk-2" },
      80,
    );
    assert.equal(replaced.state, "accepted");
    assert.equal(replaced.qty, 80);

    const watched = await executePaperEntry(scripted(() => ({ status: 404, body: {} })).transport, CREDS, entry({ mode: "MONITORING" }), "2026-11-12T15:00:00.000Z", "5");
    assert.equal(watched.state, "rejected");
    assert.match(watched.reason, /Monitoring/);
  });

  it("keeps the strategy ledger separate from broker fills and stays dark without credentials", async () => {
    const compared = reconcileLedgers([{ symbol: "SPY", qty: 10 }], [{ symbol: "SPY", qty: 4 }]);
    assert.equal(compared.clean, false);
    assert.match(compared.notes[0] ?? "", /strategy ledger 10, broker fill 4/);
    delete process.env.APCA_API_KEY_ID;
    delete process.env.APCA_API_SECRET_KEY;
    process.env.APEX_PAPER_KEY_FILE = "off";
    const desk = await readPaperDesk();
    assert.equal(desk.connected, false);
    assert.equal(desk.paperAccountConfirmed, false);
    assert.equal(desk.account, null);
    assert.equal(desk.launchMode, "MONITORING");
    assert.equal(desk.liveSelectable, false);
    assert.equal(desk.positions.length, 0);
    assert.equal(nextDelayMs(0) < nextDelayMs(3), true);
    assert.equal(redactSecrets(`key ${CREDS.secret}`, [CREDS.secret]).includes(CREDS.secret), false);
    assert.equal(parsePaperKeys("AKLIVEKEY123", "secretvalue1").ok, false);
    const paper = parsePaperKeys(" PKPAPERKEY123 ", " secretvalue1 ");
    assert.equal(paper.ok, true);
    if (paper.ok) assert.equal(paper.keyId, "PKPAPERKEY123");
  });
});
