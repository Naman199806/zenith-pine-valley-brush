import type { Bar } from "./competition.ts";

export const PHASE7 = {
  "gld-real-rate-v1": {
    rationale: "Gold is held only when long-duration Treasuries are rising over 63 sessions, a proxy for falling real yields. Otherwise cash.",
    failure: "Reject unless validation beats GLD buy-and-hold after costs with at least 12 trades.",
    costsBps: 5,
  },
  "eth-btc-relative-v1": {
    rationale: "ETH is held only when its 20-session return exceeds BTC by 5 percentage points. Otherwise cash. This is cross-asset crypto leadership, not BTC trend following.",
    failure: "Reject unless validation beats ETH buy-and-hold after costs with at least 12 trades.",
    costsBps: 25,
  },
} as const;

function run(signal: boolean[], bars: Bar[], cost: number) {
  let cash = 100000, qty = 0, trades = 0, peak = 100000, maxDd = 0;
  for (let i = 0; i < signal.length - 1; i++) {
    const next = bars[i + 1];
    if (signal[i] && qty === 0) { qty = cash / (next.o * (1 + cost)); cash = 0; trades++; }
    if (!signal[i] && qty > 0) { cash = qty * next.o * (1 - cost); qty = 0; trades++; }
    const eq = cash + qty * bars[i].c;
    peak = Math.max(peak, eq);
    maxDd = Math.max(maxDd, peak ? (peak - eq) / peak : 0);
  }
  const end = cash + qty * bars.at(-1)!.c;
  return { trades, net: end / 100000 - 1, maxDd, bench: bars.at(-1)!.c / bars[0].c - 1 };
}

export function evalGld(gld: Bar[], tlt: Bar[], from: string, to: string) {
  const tltBy = new Map(tlt.map((b) => [b.t, b.c]));
  const rows = gld.filter((b) => b.t >= from && b.t <= to && tltBy.has(b.t));
  const signal = rows.map((b, i) => {
    if (i < 63) return false;
    const prev = tltBy.get(rows[i - 63].t);
    const now = tltBy.get(b.t);
    return prev != null && now != null && now > prev;
  });
  const result = run(signal, rows, 0.0005);
  const enough = result.trades >= 12;
  return { ...result, decision: !enough ? "INSUFFICIENT_EVIDENCE" : result.net > result.bench && result.net > 0 ? "ELIGIBLE_FOR_FURTHER_VALIDATION" : "REJECTED" };
}

export function evalEthBtc(eth: Bar[], btc: Bar[], from: string, to: string) {
  const btcBy = new Map(btc.map((b) => [b.t, b.c]));
  const rows = eth.filter((b) => b.t >= from && b.t <= to && btcBy.has(b.t));
  const signal = rows.map((b, i) => {
    if (i < 20) return false;
    const ethRet = b.c / rows[i - 20].c - 1;
    const btcNow = btcBy.get(b.t), btcPrev = btcBy.get(rows[i - 20].t);
    return btcNow != null && btcPrev != null && ethRet - (btcNow / btcPrev - 1) > 0.05;
  });
  const result = run(signal, rows, 0.0025);
  const enough = result.trades >= 12;
  return { ...result, decision: !enough ? "INSUFFICIENT_EVIDENCE" : result.net > result.bench && result.net > 0 ? "ELIGIBLE_FOR_FURTHER_VALIDATION" : "REJECTED" };
}
