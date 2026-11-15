import assert from "node:assert/strict";
import test from "node:test";
import { selectFromFrozen } from "./phase2.ts";

test("frozen research cannot invent a winner", () => {
  const selected = selectFromFrozen({ candidates: [{ validation: { id: "x", decision: "REJECTED", netReturn: 0.1, benchmark: 0.2, trades: 40 } }] });
  assert.equal(selected.selected, "NO_WINNER");
});

test("only an independently validated candidate can be selected", () => {
  const selected = selectFromFrozen({ candidates: [{ validation: { id: "ok", decision: "ELIGIBLE_FOR_FURTHER_VALIDATION", netReturn: 0.2, benchmark: 0.1, trades: 40 } }] });
  assert.equal(selected.selected, "ok");
});
