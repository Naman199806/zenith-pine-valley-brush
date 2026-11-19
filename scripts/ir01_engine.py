"""IR-01 corrected engine. Published rules unchanged. Paths are portable."""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "research/data/raw/yahoo/20261112"


def load(symbol: str) -> list[dict]:
    doc = json.loads((DATA / f"{symbol}.json").read_text())
    bars = []
    for b in doc["bars"]:
        close = float(b["close"])
        adj = float(b["yahooAdjClose"])
        scale = adj / close if close else 1.0
        bars.append({"date": b["date"], "open": float(b["open"]) * scale, "high": float(b["high"]) * scale, "low": float(b["low"]) * scale, "close": adj})
    return [b for b in bars if b["date"] >= "2009-01-01"]


def inside(cur: dict, prev: dict) -> bool:
    return cur["high"] <= prev["high"] and cur["low"] >= prev["low"]


def run(symbol: str, cost: float) -> dict:
    bars = load(symbol)
    closes = [b["close"] for b in bars]
    streak = 0
    setup_highs: list[float] = []
    setup_lows: list[float] = []
    armed_long = None
    armed_short = None
    held = None
    cash, qty = 100.0, 0.0
    trades, equity, events = [], [], []
    realized = 0.0
    for i, bar in enumerate(bars):
        ma = sum(closes[i + 1 - 18:i + 1]) / 18 if i >= 17 else None
        if i and ma is not None:
            if not inside(bar, bars[i - 1]) and bar["low"] > ma:
                streak = streak + 1 if streak > 0 else 1
                setup_highs.append(bar["high"])
                if streak == 2:
                    armed_long = {"level": max(setup_highs[-2:]), "armedOn": bar["date"]}
                    events.append({"date": bar["date"], "event": "arm-long"})
            elif not inside(bar, bars[i - 1]) and bar["high"] < ma:
                streak = streak - 1 if streak < 0 else -1
                setup_lows.append(bar["low"])
                if streak == -2:
                    armed_short = {"level": min(setup_lows[-2:]), "armedOn": bar["date"]}
                    if armed_long and held is None:
                        events.append({"date": bar["date"], "event": "cancel-long"})
                        armed_long = None
                    events.append({"date": bar["date"], "event": "arm-short"})
            else:
                streak = 0
            if armed_long and held is None and bar["low"] <= ma and events[-1]["event"] != "arm-long":
                events.append({"date": bar["date"], "event": "invalidate-long"})
                armed_long = None
        if i:
            prev_long, prev_short = armed_long, armed_short
            if held and prev_short and prev_short["armedOn"] > held["entry"] and bar["low"] < prev_short["level"]:
                fill = bar["open"] if bar["open"] < prev_short["level"] else prev_short["level"]
                proceeds = qty * fill * (1 - cost)
                pnl = proceeds - held["entryCash"]
                realized += pnl
                trades.append({**held, "exit": bar["date"], "exitPx": fill, "pnl": pnl, "cost": held["entryCash"] * cost + qty * fill * cost})
                cash, qty, held = proceeds, 0.0, None
                events.append({"date": bar["date"], "event": "consume-short"})
                armed_short = None
            elif not held and prev_long and bar["high"] > prev_long["level"]:
                fill = bar["open"] if bar["open"] > prev_long["level"] else prev_long["level"]
                qty = cash * (1 - cost) / fill
                held = {"symbol": symbol, "entry": bar["date"], "entryPx": fill, "entryCash": cash, "setupArmedOn": prev_long["armedOn"]}
                cash = 0.0
                events.append({"date": bar["date"], "event": "consume-long"})
                armed_long = None
        equity.append({"date": bar["date"], "equity": cash + qty * bar["close"], "realized": realized, "unrealized": (qty * bar["close"] - held["entryCash"]) if held else 0.0})
    return {"symbol": symbol, "trades": trades, "equity": equity, "events": events, "open": held}


def segment(result: dict, start: str, end: str) -> dict:
    eq = [e for e in result["equity"] if start <= e["date"] <= end]
    closed = [t for t in result["trades"] if start <= t["exit"] <= end]
    spanning = [t for t in closed if t["entry"] < start]
    if not eq:
        return {}
    base = eq[0]["equity"]
    return {
        "totalReturn": eq[-1]["equity"] / base - 1,
        "realizedInPeriod": sum(t["pnl"] for t in closed),
        "unrealizedEnd": eq[-1]["unrealized"],
        "completedTrades": len(closed),
        "spanningTrades": len(spanning),
        "costs": sum(t["cost"] for t in closed),
    }
