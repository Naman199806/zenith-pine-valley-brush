"""IR-01 V1.2. Fills use only setups known at the previous close."""

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


def run_bars(bars: list[dict], cost: float, symbol: str = "SYNTH") -> dict:
    streak = 0
    setup_highs: list[float] = []
    setup_lows: list[float] = []
    armed_long = None
    armed_short = None
    held = None
    cash, qty, realized, fees = 100.0, 0.0, 0.0, 0.0
    trades, equity, events = [], [], []
    for i, bar in enumerate(bars):
        known_long, known_short = armed_long, armed_short
        if known_short and held and known_short["armedOn"] > held["entry"] and bar["low"] < known_short["level"]:
            fill = bar["open"] if bar["open"] < known_short["level"] else known_short["level"]
            fee = qty * fill * cost
            proceeds = qty * fill - fee
            pnl = proceeds - held["entryCash"]
            realized += pnl
            fees += held["entryFee"] + fee
            trades.append({**held, "exit": bar["date"], "exitPx": fill, "pnl": pnl, "fees": held["entryFee"] + fee})
            cash, qty, held = proceeds, 0.0, None
            armed_short = None
            events.append({"date": bar["date"], "event": "fill-exit", "fromPriorClose": True})
        elif known_long and not held and bar["high"] > known_long["level"]:
            fill = bar["open"] if bar["open"] > known_long["level"] else known_long["level"]
            fee = cash * cost
            qty = (cash - fee) / fill
            held = {"symbol": symbol, "entry": bar["date"], "entryPx": fill, "entryCash": cash, "entryFee": fee, "setupArmedOn": known_long["armedOn"]}
            cash = 0.0
            armed_long = None
            events.append({"date": bar["date"], "event": "fill-entry", "fromPriorClose": True, "fill": fill})
        equity.append({"date": bar["date"], "openEquity": cash + qty * bar["open"], "equity": cash + qty * bar["close"], "realized": realized, "unrealized": (qty * bar["close"] - held["entryCash"]) if held else 0.0, "fees": fees})
        ma = sum(b["close"] for b in bars[i + 1 - 18:i + 1]) / 18 if i >= 17 else None
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
                        armed_long = None
                        events.append({"date": bar["date"], "event": "cancel-long"})
                    events.append({"date": bar["date"], "event": "arm-short"})
            else:
                streak = 0
            if armed_long and held is None and bar["low"] <= ma:
                armed_long = None
                events.append({"date": bar["date"], "event": "invalidate-long"})
    return {"symbol": symbol, "trades": trades, "equity": equity, "events": events, "open": held, "fees": fees, "realized": realized}


def run(symbol: str, cost: float) -> dict:
    return run_bars(load(symbol), cost, symbol)


def segment(result: dict, start: str, end: str) -> dict:
    eq = [e for e in result["equity"] if start <= e["date"] <= end]
    closed = [t for t in result["trades"] if start <= t["exit"] <= end]
    if not eq:
        return {}
    opening = eq[0]["openEquity"]
    ending = eq[-1]["equity"]
    return {
        "openingEquity": opening,
        "endingEquity": ending,
        "totalReturn": ending / opening - 1,
        "realizedInPeriod": sum(t["pnl"] for t in closed),
        "unrealizedEnd": eq[-1]["unrealized"],
        "fees": sum(t["fees"] for t in closed),
        "completedTrades": len(closed),
        "spanningTrades": len([t for t in closed if t["entry"] < start]),
    }
