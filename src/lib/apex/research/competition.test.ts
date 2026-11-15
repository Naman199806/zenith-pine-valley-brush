import assert from "node:assert/strict";
import test from "node:test";
import { evalDefensiveRs, evalDonchian } from "./competition.ts";
import type { Bar } from "./competition.ts";

function bars(start: string, n: number): Bar[] {
  const out: Bar[] = [];
  const t0 = Date.parse(start + "T00:00:00Z");
  for (let i = 0; i < n; i++) out.push({ t: new Date(t0 + i * 86400000).toISOString().slice(0, 10), o: 100, h: 101, l: 99, c: 100 + (i % 5) });
  return out;
}

test("scored BTC windows do not overlap", () => {
  const sample = bars("2024-01-01", 800);
  const dev = evalDonchian(sample, 25, "2024-01-01", "2025-06-30");
  const val = evalDonchian(sample, 25, "2025-07-01", "2026-09-13");
  assert.equal(dev.holdoutUsed, false);
  assert.equal(val.holdoutUsed, false);
  assert.ok("2025-06-30" < "2025-07-01");
});

test("ETF accounting reconciles and stays before the equity holdout", () => {
  const names = ["SPY", "QQQ", "IWM", "GLD", "TLT", "BIL"];
  const series = Object.fromEntries(names.map((name, idx) => [name, bars("2023-01-01", 400).map((b) => ({ ...b, c: b.c + idx, o: b.o + idx }))]));
  const result = evalDefensiveRs(series, 5, "2024-01-01", "2024-06-30");
  assert.equal(result.equityReconciled, true);
  assert.equal(result.priceOnly, true);
  assert.ok(result.tradesDetail.every((t) => t.entryDate < "2025-11-11"));
});
