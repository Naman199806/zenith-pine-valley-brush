"""IR-03 corrected engine. Matches the frozen spec. Defective results are preserved separately."""

from __future__ import annotations

import json
from pathlib import Path

from ir01_engine import load

ROOT = Path(__file__).resolve().parents[1]


def confirmed_pivots(bars: list[dict], kind: str) -> list[dict]:
    pivots = []
    key = "high" if kind == "high" else "low"
    for i in range(2, len(bars) - 2):
        window = [bars[j][key] for j in range(i - 2, i + 3) if j != i]
        extreme = bars[i][key] > max(window) if kind == "high" else bars[i][key] < min(window)
        if extreme:
            pivots.append({"index": i, "confirm": i + 2, "date": bars[i]["date"], "price": bars[i][key]})
    return pivots


def projected_line(older: dict, newer: dict, index: int) -> float:
    span = newer["index"] - older["index"]
    slope = (newer["price"] - older["price"]) / span
    return newer["price"] + slope * (index - newer["index"])


def run_bars(bars: list[dict], cost: float, symbol: str = "SYNTH") -> dict:
    lows = confirmed_pivots(bars, "low")
    highs = confirmed_pivots(bars, "high")
    cash, qty, held = 100.0, 0.0, None
    trades = []
    for i in range(5, len(bars) - 1):
        known_lows = [p for p in lows if p["confirm"] <= i]
        known_highs = [p for p in highs if p["confirm"] <= i]
        pair = None
        for a, b in zip(known_lows, known_lows[1:]):
            if b["price"] > a["price"]:
                pair = (a, b)
        line = projected_line(*pair, i) if pair else None
        if held and line is not None and bars[i]["close"] < line:
            fill = bars[i + 1]["open"]
            proceeds = qty * fill * (1 - cost)
            trades.append({**held, "exit": bars[i + 1]["date"], "exitPx": fill, "pnl": proceeds - held["entryCash"], "status": "closed"})
            cash, qty, held = proceeds, 0.0, None
            continue
        prior_swing_high = known_highs[-1]["price"] if known_highs else None
        if not held and line is not None and prior_swing_high is not None and bars[i - 1]["close"] > line and bars[i]["close"] > prior_swing_high:
            fill = bars[i + 1]["open"]
            qty = cash * (1 - cost) / fill
            held = {"symbol": symbol, "entry": bars[i + 1]["date"], "entryIndex": i + 1, "entryPx": fill, "entryCash": cash, "triggerHigh": prior_swing_high}
            cash = 0.0
    open_position = None
    if held:
        last = bars[-1]
        open_position = {
            **held,
            "status": "open",
            "holdingBars": len(bars) - 1 - held["entryIndex"],
            "unrealizedPnl": qty * last["close"] - held["entryCash"],
            "capitalExposure": qty * last["close"],
        }
    end = cash if not held else qty * bars[-1]["close"]
    return {"symbol": symbol, "trades": trades, "open": open_position, "endingEquity": end}


def run(symbol: str, cost: float) -> dict:
    return run_bars(load(symbol), cost, symbol)


def main() -> None:
    out = {
        "id": "ir03-confirmed-pivot-v1.1",
        "parent": "defective-results.json",
        "exploratory": True,
        "previouslyInspected": True,
        "independentValidation": False,
        "strategyApproved": False,
        "verdict": "NO_WINNER",
        "symbols": {},
    }
    for symbol in ("SPY", "QQQ", "IWM"):
        base, two, severe = run(symbol, 0.0006), run(symbol, 0.0012), run(symbol, 0.005)
        out["symbols"][symbol] = {
            "baselineEnd": base["endingEquity"],
            "twoXEnd": two["endingEquity"],
            "severe50bpsEnd": severe["endingEquity"],
            "closedTrades": len(base["trades"]),
            "open": base["open"],
            "ledger": base["trades"],
        }
    path = ROOT / "research/lab/ir03-trendline/corrected-results.json"
    path.write_text(json.dumps(out, indent=2))
    print(out["verdict"], {s: out["symbols"][s]["closedTrades"] for s in out["symbols"]})


if __name__ == "__main__":
    main()
