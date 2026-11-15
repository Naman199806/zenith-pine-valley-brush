import assert from "node:assert/strict";
import test from "node:test";
import { runAgents } from "./agent-adapters.ts";
import { backtestFmz } from "./fmz-backtest.ts";
import { assertOrderEndpoint, liveReadiness } from "../broker/live-guard.ts";
import type { Bar } from "./fmz-bb-rsi.ts";

function bars(n: number): Bar[] {
  return Array.from({ length: n }, (_, i) => ({ t: new Date(Date.parse("2026-10-01T00:00:00Z") + i * 900000).toISOString(), o: 100 + i, h: 101 + i, l: 99 + i, c: 100 + i }));
}

test("all 13 roles are represented by adapters plus decision roles", () => {
  const agents = runAgents({ symbol: "BTC/USD", bars: bars(10), nowMs: Date.now(), hasMacro: false, hasNews: false, hasDerivatives: false, hasFundamentals: false });
  assert.equal(agents.length, 8);
  assert.equal(agents.find((a) => a.role === "atlas")?.state, "NOT_APPLICABLE");
  assert.equal(agents.find((a) => a.role === "bull")?.modelCall, false);
});

test("FMZ short sample is insufficient evidence", () => {
  const result = backtestFmz(bars(260));
  assert.equal(result.decision, "INSUFFICIENT_EVIDENCE");
});

test("live endpoint is hard blocked", () => {
  assert.throws(() => assertOrderEndpoint("https://api.alpaca.markets/v2/orders"), /LIVE endpoint blocked/);
  assert.doesNotThrow(() => assertOrderEndpoint("https://paper-api.alpaca.markets/v2/orders"));
  assert.equal(liveReadiness().autonomousLive, "NO-GO");
});
