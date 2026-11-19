"""IR-03 confirmed-pivot trendline. Spec frozen before this run."""

from __future__ import annotations

import json
from pathlib import Path

from ir01_engine import load

ROOT = Path(__file__).resolve().parents[1]


def confirmed_pivots(bars: list[dict]) -> list[dict]:
    pivots = []
    for i in range(2, len(bars) - 2):
        window = bars[i - 2:i + 3]
        if bars[i]["low"] < min(b["low"] for j, b in enumerate(window) if j != 2):
            pivots.append({"index": i, "confirm": i + 2, "date": bars[i]["date"], "low": bars[i]["low"]})
    return pivots


def run(symbol: str, cost: float) -> dict:
    bars = load(symbol)
    pivots = confirmed_pivots(bars)
    cash, qty, held = 100.0, 0.0, None
    trades = []
    for i in range(5, len(bars) - 1):
        known = [p for p in pivots if p["confirm"] <= i]
        if len(known) < 2 or known[-1]["low"] <= known[-2]["low"]:
            continue
        line = known[-1]["low"]
        if not held and bars[i - 1]["close"] > line and bars[i]["close"] > bars[i - 1]["high"]:
            fill = bars[i + 1]["open"]
            qty = cash * (1 - cost) / fill
            held = {"symbol": symbol, "entry": bars[i + 1]["date"], "entryPx": fill, "entryCash": cash, "line": line}
            cash = 0.0
        elif held and bars[i]["close"] < held["line"]:
            fill = bars[i + 1]["open"]
            proceeds = qty * fill * (1 - cost)
            trades.append({**held, "exit": bars[i + 1]["date"], "exitPx": fill, "pnl": proceeds - held["entryCash"]})
            cash, qty, held = proceeds, 0.0, None
    end = cash if not held else qty * bars[-1]["close"]
    return {"symbol": symbol, "trades": trades, "endingEquity": end, "open": held}


def main() -> None:
    out = {"id": "ir03-confirmed-pivot-v1", "exploratory": True, "previouslyInspected": True, "strategyApproved": False, "verdict": "NO_WINNER", "symbols": {}}
    for symbol in ("SPY", "QQQ", "IWM"):
        base, two, severe = run(symbol, 0.0006), run(symbol, 0.0012), run(symbol, 0.005)
        out["symbols"][symbol] = {
            "baselineEnd": base["endingEquity"],
            "twoXEnd": two["endingEquity"],
            "severe50bpsEnd": severe["endingEquity"],
            "trades": len(base["trades"]),
            "ledger": base["trades"],
        }
    path = ROOT / "research/lab/ir03-trendline/results.json"
    path.write_text(json.dumps(out, indent=2))
    print(out["verdict"], {s: out["symbols"][s]["trades"] for s in out["symbols"]})


if __name__ == "__main__":
    main()
