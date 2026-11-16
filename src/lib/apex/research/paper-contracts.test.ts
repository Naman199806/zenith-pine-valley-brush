import assert from "node:assert/strict";
import test from "node:test";
import { acceptProposal, applyMockFill, authorizeMockExit, type MockBook } from "./paper-contracts.ts";

const proposal = {
  decisionId: "d1", clientOrderId: "c1", symbol: "SPY" as const, side: "buy" as const,
  qty: 0.03, limitPrice: 750, signed: true, sigmaApproved: true, sentinelApproved: true, strategyApproved: false as const,
};

test("unsigned, vetoed and duplicate proposals are rejected", () => {
  const seen = new Set<string>();
  assert.equal(acceptProposal({ ...proposal, signed: false }, seen).ok, false);
  assert.equal(acceptProposal({ ...proposal, sigmaApproved: false }, seen).ok, false);
  assert.equal(acceptProposal(proposal, seen).ok, true);
  assert.equal(acceptProposal(proposal, seen).reason, "duplicate");
});

test("mock partial fill and exit are not real performance", () => {
  const book: MockBook = { state: "AUTHORIZED", filledQty: 0, seen: [], realPerformance: false };
  const partial = applyMockFill(book, { clientOrderId: "c1", qty: 0.01, price: 750, source: "MOCK" });
  assert.equal(partial.state, "PARTIAL");
  assert.equal(partial.realPerformance, false);
  assert.equal(authorizeMockExit(partial, 0.01, 0.01).state, "EXIT_PENDING");
  assert.throws(() => authorizeMockExit(partial, 0.02, 0.01), /oversell/);
});
