import { readFileSync, writeFileSync } from "node:fs";
import { evalDonchian, evalMeanRevert, evalDefensiveRs } from "../src/lib/apex/research/competition.ts";
import { runAgents } from "../src/lib/apex/research/agent-adapters.ts";

function btcBars() {
  const raw = JSON.parse(readFileSync("research/data/raw/coinbase/20261112/BTC-USD.json", "utf8")).bars;
  return raw.filter((b) => new Date(b.ts * 1000).toISOString() < "2026-09-14").map((b) => ({ t: new Date(b.ts * 1000).toISOString().slice(0, 10), o: b.open, h: b.high, l: b.low, c: b.close }));
}
function etf(symbol) {
  const raw = JSON.parse(readFileSync(`research/data/raw/yahoo/20261112/${symbol}.json`, "utf8")).bars;
  return raw.filter((b) => b.date < "2025-11-11").map((b) => ({ t: b.date, o: b.open, h: b.high, l: b.low, c: b.close }));
}
const btc = btcBars();
const dev = btc.filter((b) => b.t < "2025-07-01");
const val = btc.filter((b) => b.t >= "2025-01-01");
const symbols = ["SPY", "QQQ", "IWM", "GLD", "TLT", "BIL"];
const series = Object.fromEntries(symbols.map((s) => [s, etf(s)]));
const results = {
  frozenManifest: "research/lab/strategies/competition-20261115.json",
  holdouts: { btcFrom: "2026-09-14", equityFrom: "2025-11-11", used: false },
  candidates: [
    { development: evalDonchian(dev), validation: evalDonchian(val) },
    { development: evalMeanRevert(dev), validation: evalMeanRevert(val) },
    { development: evalDefensiveRs(series), validation: evalDefensiveRs(Object.fromEntries(symbols.map((s) => [s, series[s].filter((b) => b.t >= "2024-01-01")]))) },
  ],
};
const winner = results.candidates.find((c) => c.validation.decision === "ELIGIBLE_FOR_FURTHER_VALIDATION");
results.selected = winner ? winner.validation.id : "NO_WINNER";
results.agents = runAgents({ symbol: "BTC/USD", bars: btc.slice(-300).map((b) => ({ ...b, t: b.t + "T00:00:00Z" })), nowMs: Date.now(), hasMacro: false, hasNews: false, hasDerivatives: false, hasFundamentals: false });
results.aiModelCalls = 0;
results.brokerWrites = 0;
writeFileSync("research/lab/competition-20261115.json", JSON.stringify(results, null, 2));
console.log(JSON.stringify({ selected: results.selected, rows: results.candidates.map((c) => ({ id: c.validation.id, dev: c.development.decision, val: c.validation.decision, trades: c.validation.trades, net: c.validation.netReturn, pf: c.validation.profitFactor, dd: c.validation.maxDrawdown, bench: c.validation.benchmark })) }, null, 2));
