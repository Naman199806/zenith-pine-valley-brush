import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyFill, emptyLedger, loadChecked, saveAtomic } from "./ledger.ts";
import { reconcile } from "../broker/reconcile-paper.ts";
import { validateOrder } from "./ledger.ts";

test("duplicate execution ids are ignored and P&L reconciles", () => {
  let ledger = emptyLedger(1000);
  ledger = applyFill(ledger, { executionId: "e1", clientOrderId: "c1", side: "buy", qty: 0.001, price: 100, fee: 0.01, at: "2026-11-15T07:00:00Z" });
  ledger = applyFill(ledger, { executionId: "e1", clientOrderId: "c1", side: "buy", qty: 0.001, price: 100, fee: 0.01, at: "2026-11-15T07:00:00Z" });
  ledger = applyFill(ledger, { executionId: "e2", clientOrderId: "c2", side: "sell", qty: 0.001, price: 110, fee: 0.01, at: "2026-11-15T07:05:00Z" });
  assert.equal(ledger.fills.length, 2);
  assert.equal(ledger.position, 0);
  assert.equal(ledger.realized, -0.01);
  assert.equal(ledger.cash, 999.99);
});

test("partial fill survives restart and corrupted state fails closed", () => {
  const dir = mkdtempSync(join(tmpdir(), "apex-ledger-"));
  const path = join(dir, "ledger.json");
  const ledger = applyFill(emptyLedger(1000), { executionId: "p1", clientOrderId: "c1", side: "buy", qty: 0.0004, price: 65000, fee: 0.1, at: "2026-11-15T07:00:00Z" });
  saveAtomic(path, ledger);
  const restored = loadChecked(path);
  assert.equal(restored.position, 0.0004);
  writeFileSync(path, "{bad");
  assert.throws(() => loadChecked(path), /corrupted ledger/);
  assert.throws(() => loadChecked(join(dir, "missing.json")), /refusing to invent/);
});

test("simultaneous writers are rejected", () => {
  const dir = mkdtempSync(join(tmpdir(), "apex-lock-"));
  const path = join(dir, "ledger.json");
  saveAtomic(path, emptyLedger());
  writeFileSync(`${path}.lock`, "held");
  assert.throws(() => saveAtomic(path, emptyLedger()), /writer already active/);
});

test("broker mismatches and incomplete snapshots block entries", () => {
  const mismatch = reconcile({ "BTC/USD": 0.001 }, { account: { status: "ACTIVE", cash: "1" }, positions: [{ symbol: "BTC/USD", qty: "0" }], openOrders: [], recentOrders: [] }, []);
  assert.equal(mismatch.entriesBlocked, true);
  const incomplete = reconcile({}, { account: null, positions: [], openOrders: [], recentOrders: [] }, []);
  assert.equal(incomplete.ok, false);
});

test("order validation uses the supplied price, not a hardcoded BTC price", () => {
  assert.equal(validateOrder({ symbol: "ETH/USD", qty: 0.001, price: 2000, cash: 1, increment: 0.0001, minNotional: 1, feeRate: 0.0025 }).ok, false);
  assert.equal(validateOrder({ symbol: "ETH/USD", qty: 0.001, price: 2000, cash: 10, increment: 0.0001, minNotional: 1, feeRate: 0 }).ok, true);
});
