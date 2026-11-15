import { readFileSync, writeFileSync } from "node:fs";
import { evalDonchian, evalMeanRevert, evalDefensiveRs } from "../src/lib/apex/research/competition.ts";

function btcBars() {
  const raw = JSON.parse(readFileSync("research/data/raw/coinbase/20261112/BTC-USD.json", "utf8")).bars;
  return raw.filter((b) => new Date(b.ts * 1000).toISOString() < "2026-09-14").map((b) => ({ t: new Date(b.ts * 1000).toISOString().slice(0, 10), o: b.open, h: b.high, l: b.low, c: b.close }));
}
function etf(symbol) {
  const raw = JSON.parse(readFileSync(`research/data/raw/yahoo/20261112/${symbol}.json`, "utf8")).bars;
  return raw.filter((b) => b.date < "2025-11-11").map((b) => ({ t: b.date, o: b.open, h: b.high, l: b.low, c: b.close }));
}
const btc = btcBars();
const symbols = ["SPY", "QQQ", "IWM", "GLD", "TLT", "BIL"];
const series = Object.fromEntries(symbols.map((s) => [s, etf(s)]));
const btcDevTo = "2025-06-30";
const btcValFrom = "2025-07-01";
const btcValTo = "2026-09-13";
const etfDevTo = "2023-12-31";
const etfValFrom = "2024-01-01";
const etfValTo = "2025-11-10";
const results = {
  frozenManifest: "research/lab/strategies/competition-20261115.json",
  windows: { btcDevelopment: ["2024-01-01", btcDevTo], btcValidation: [btcValFrom, btcValTo], etfDevelopment: ["1993-01-29", etfDevTo], etfValidation: [etfValFrom, etfValTo] },
  holdouts: { btcFrom: "2026-09-14", equityFrom: "2025-11-11", used: false },
  priceOnly: true,
  candidates: [
    { development: evalDonchian(btc, 25, "2024-01-01", btcDevTo), validation: evalDonchian(btc, 25, btcValFrom, btcValTo) },
    { development: evalMeanRevert(btc, 25, "2024-01-01", btcDevTo), validation: evalMeanRevert(btc, 25, btcValFrom, btcValTo) },
    { development: evalDefensiveRs(series, 5, "1993-01-29", etfDevTo), validation: evalDefensiveRs(series, 5, etfValFrom, etfValTo) },
  ],
};
results.selected = results.candidates.find((c) => c.validation.decision === "ELIGIBLE_FOR_FURTHER_VALIDATION")?.validation.id ?? "NO_WINNER";
results.aiModelCalls = 0;
results.brokerWrites = 0;
writeFileSync("research/lab/competition-20261115.json", JSON.stringify(results, null, 2));
console.log(JSON.stringify({ selected: results.selected, rows: results.candidates.map((c) => ({ id: c.validation.id, dev: c.development.decision, val: c.validation.decision, trades: c.validation.trades, net: c.validation.netReturn, pf: c.validation.profitFactor, dd: c.validation.maxDrawdown, bench: c.validation.benchmark, reconciled: c.validation.equityReconciled ?? null })) }, null, 2));
