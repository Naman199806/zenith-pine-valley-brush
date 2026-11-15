import assert from "node:assert/strict";
import test from "node:test";
import { evalDonchian } from "./competition.ts";
import type { Bar } from "./competition.ts";

test("competition evaluator does not invent a winner from a flat sample", () => {
  const bars: Bar[] = Array.from({ length: 250 }, (_, i) => ({ t: `2024-01-${String((i % 28) + 1).padStart(2, "0")}`, o: 100, h: 101, l: 99, c: 100 }));
  const result = evalDonchian(bars);
  assert.equal(result.holdoutUsed, false);
  assert.notEqual(result.decision, "ELIGIBLE_FOR_FURTHER_VALIDATION");
});
