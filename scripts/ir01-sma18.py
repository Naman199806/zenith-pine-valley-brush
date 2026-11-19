#!/usr/bin/env python3
"""IR-01 Rosputnia 18MA breakout. Spec frozen in research/lab/ir01-sma18/spec.json."""

from __future__ import annotations

import json
import math
from pathlib import Path

ROOT = Path("/workspace")
DATA = ROOT / "research/data/raw/yahoo/20261112"
OUT = ROOT / "research/lab/ir01-sma18"
SPEC = json.loads((OUT / "spec.json").read_text())


def load(symbol: str) -> list[dict]:
    doc = json.loads((DATA / f"{symbol}.json").read_text())
    bars = []
    for b in doc["bars"]:
        close = float(b["close"])
        adj = float(b["yahooAdjClose"])
        scale = adj / close if close else 1.0
        bars.append({
            "date": b["date"],
            "open": float(b["open"]) * scale,
            "high": float(b["high"]) * scale,
            "low": float(b["low"]) * scale,
            "close": adj,
        })
    return bars


def sma(vals: list[float], i: int, n: int) -> float | None:
    if i + 1 < n:
        return None
    return sum(vals[i + 1 - n:i + 1]) / n


def inside(cur: dict, prev: dict) -> bool:
    return cur["high"] <= prev["high"] and cur["low"] >= prev["low"]


def signals(bars: list[dict]) -> list[dict]:
    closes = [b["close"] for b in bars]
    out = []
    streak = 0
    highs: list[float] = []
    lows: list[float] = []
    active_high = None
    active_low = None
    for i, bar in enumerate(bars):
        ma = sma(closes, i, 18)
        setup_up = ma is not None and bar["low"] > ma and (i == 0 or not inside(bar, bars[i - 1]))
        setup_dn = ma is not None and bar["high"] < ma and (i == 0 or not inside(bar, bars[i - 1]))
        if setup_up:
            streak = streak + 1 if streak > 0 else 1
            highs.append(bar["high"])
            if streak == 2:
                active_high = max(highs[-2:])
        elif setup_dn:
            streak = streak - 1 if streak < 0 else -1
            lows.append(bar["low"])
            if streak == -2:
                active_low = min(lows[-2:])
        else:
            streak = 0
        out.append({"date": bar["date"], "activeHigh": active_high, "activeLow": active_low, "sma18": ma})
    return out


def run(symbol: str, cost: float) -> dict:
    bars = [b for b in load(symbol) if b["date"] >= "2009-01-01"]
    sig = signals(bars)
    cash, qty, entry, held = 100.0, 0.0, 0.0, False
    trades = []
    equity = []
    for i in range(1, len(bars)):
        prev = sig[i - 1]
        bar = bars[i]
        if not held and prev["activeHigh"] is not None and bar["high"] > prev["activeHigh"]:
            fill = bar["open"] if bar["open"] > prev["activeHigh"] else prev["activeHigh"]
            qty = cash * (1 - cost) / fill
            entry = cash
            cash = 0.0
            held = True
            trades.append({"symbol": symbol, "entry": bar["date"], "entryPx": fill})
        elif held and prev["activeLow"] is not None and bar["low"] < prev["activeLow"]:
            fill = bar["open"] if bar["open"] < prev["activeLow"] else prev["activeLow"]
            proceeds = qty * fill * (1 - cost)
            trades[-1].update({"exit": bar["date"], "exitPx": fill, "pnl": proceeds - entry})
            cash = proceeds
            qty, held = 0.0, False
        equity.append({"date": bar["date"], "equity": cash + (qty * bar["close"] if held else 0.0)})
    return {"symbol": symbol, "trades": trades, "equity": equity}


def metrics(equity: list[dict], trades: list[dict]) -> dict:
    vals = [e["equity"] for e in equity]
    if len(vals) < 2:
        return {}
    rets = [vals[i] / vals[i - 1] - 1 for i in range(1, len(vals))]
    peak, dd = vals[0], 0.0
    for v in vals:
        peak = max(peak, v)
        dd = min(dd, v / peak - 1)
    years = len(rets) / 252
    downside = [r for r in rets if r < 0]
    mean = sum(rets) / len(rets)
    var = sum((r - mean) ** 2 for r in rets) / max(len(rets) - 1, 1)
    dvar = sum(r * r for r in downside) / max(len(rets), 1)
    closed = [t for t in trades if "pnl" in t]
    wins = [t for t in closed if t["pnl"] > 0]
    loss = abs(sum(t["pnl"] for t in closed if t["pnl"] < 0))
    return {
        "totalReturn": vals[-1] / vals[0] - 1,
        "cagr": (vals[-1] / vals[0]) ** (1 / years) - 1 if years else 0,
        "maxDrawdown": dd,
        "sharpe": mean / math.sqrt(var) * math.sqrt(252) if var else 0,
        "sortino": mean / math.sqrt(dvar) * math.sqrt(252) if dvar else 0,
        "trades": len(closed),
        "winRate": len(wins) / len(closed) if closed else None,
        "profitFactor": (sum(t["pnl"] for t in wins) / loss) if loss else None,
        "expectancy": sum(t["pnl"] for t in closed) / len(closed) if closed else None,
    }


def buy_hold(symbol: str, cost: float) -> dict:
    bars = [b for b in load(symbol) if b["date"] >= "2009-01-01"]
    cash, qty = 100.0, 0.0
    equity = []
    if bars:
        qty = cash * (1 - cost) / bars[0]["open"]
        cash = 0.0
    for bar in bars[1:]:
        equity.append({"date": bar["date"], "equity": qty * bar["close"]})
    return {"symbol": symbol, "trades": [], "equity": equity}
    eq = [e for e in run_out["equity"] if start <= e["date"] <= end]
    trades = [t for t in run_out["trades"] if "exit" in t and start <= t["exit"] <= end]
    if eq:
        base = eq[0]["equity"]
        eq = [{"date": e["date"], "equity": e["equity"] / base * 100} for e in eq]
    return metrics(eq, trades)


def segment(run_out: dict, start: str, end: str) -> dict:
    eq = [e for e in run_out["equity"] if start <= e["date"] <= end]
    trades = [t for t in run_out["trades"] if "exit" in t and start <= t["exit"] <= end]
    if eq:
        base = eq[0]["equity"]
        eq = [{"date": e["date"], "equity": e["equity"] / base * 100} for e in eq]
    return metrics(eq, trades)


def main() -> None:
    report = {"spec": SPEC, "symbols": {}, "strategyApproved": False}
    for symbol in SPEC["universe"]:
        base = run(symbol, 0.0006)
        two = run(symbol, 0.0012)
        severe = run(symbol, 0.003)
        spy = buy_hold("SPY", 0.0006)
        report["symbols"][symbol] = {
            seg: {
                "strategy": segment(base, *bounds),
                "twoX": segment(two, *bounds)["totalReturn"],
                "severe": segment(severe, *bounds)["totalReturn"],
                "spy": segment(spy, *bounds)["totalReturn"],
            }
            for seg, bounds in {
                "development": SPEC["boundaries"]["development"],
                "validation": SPEC["boundaries"]["validation"],
                "previouslyInspected": SPEC["boundaries"]["previouslyInspected"],
            }.items()
        }
        report["symbols"][symbol]["ledger"] = [t for t in base["trades"] if "pnl" in t]
    val = report["symbols"]["SPY"]["validation"]["strategy"]
    gate = val.get("totalReturn", -1) > report["symbols"]["SPY"]["validation"]["spy"] and val.get("sharpe", 0) > 0.5 and (val.get("profitFactor") or 0) > 1.2 and report["symbols"]["SPY"]["validation"]["twoX"] > 0 and val.get("trades", 0) >= 20
    report["verdict"] = "PASS_GATE" if gate else "NO_WINNER"
    report["promotion"] = False
    (OUT / "results.json").write_text(json.dumps(report, indent=2))
    print(json.dumps({s: {k: report["symbols"][s][k]["strategy"]["totalReturn"] for k in ("development", "validation", "previouslyInspected")} for s in report["symbols"]}, indent=2))
    print(report["verdict"])


if __name__ == "__main__":
    main()
