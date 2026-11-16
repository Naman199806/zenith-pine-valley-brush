#!/usr/bin/env python3
"""Track C pre-registered ETF hypotheses. Parameters frozen. Holdout evaluated once."""

from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path

ROOT = Path("/workspace")
DATA = ROOT / "research/data/raw/yahoo/20261112"
OUT = ROOT / "research/lab/track-c-v1"
SPEC = json.loads((OUT / "preregistration.json").read_text())
COST = (SPEC["costs"]["commissionBps"] + SPEC["costs"]["slippageBps"]) / 10000


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
            "close": adj,
            "high": float(b["high"]) * scale,
            "low": float(b["low"]) * scale,
        })
    return bars


def idx(bars: list[dict]) -> dict[str, int]:
    return {b["date"]: i for i, b in enumerate(bars)}


def month_key(date: str) -> str:
    return date[:7]


def metrics(equity: list[float], trades: list[dict], dates: list[str]) -> dict:
    if len(equity) < 2:
        return {"trades": 0}
    rets = [equity[i] / equity[i - 1] - 1 for i in range(1, len(equity))]
    peak = equity[0]
    max_dd = 0.0
    for v in equity:
        peak = max(peak, v)
        max_dd = min(max_dd, v / peak - 1)
    years = max((len(rets)) / 252, 1 / 252)
    total = equity[-1] / equity[0] - 1
    cagr = (equity[-1] / equity[0]) ** (1 / years) - 1
    mean = sum(rets) / len(rets)
    var = sum((r - mean) ** 2 for r in rets) / max(len(rets) - 1, 1)
    sharpe = (mean / math.sqrt(var) * math.sqrt(252)) if var > 0 else 0.0
    wins = [t for t in trades if t["pnl"] > 0]
    losses = [t for t in trades if t["pnl"] < 0]
    gross_win = sum(t["pnl"] for t in wins)
    gross_loss = abs(sum(t["pnl"] for t in losses))
    pf = gross_win / gross_loss if gross_loss else None
    expectancy = sum(t["pnl"] for t in trades) / len(trades) if trades else None
    return {
        "start": dates[0],
        "end": dates[-1],
        "totalReturn": total,
        "cagr": cagr,
        "maxDrawdown": max_dd,
        "sharpe": sharpe,
        "trades": len(trades),
        "profitFactor": pf,
        "expectancy": expectancy,
        "winRate": len(wins) / len(trades) if trades else None,
    }


def run_targets(dates: list[str], opens: dict[str, list[float]], target: list[str | None], cost: float, start=100.0) -> tuple[list[float], list[dict]]:
    cash = start
    held = None
    qty = 0.0
    entry = 0.0
    equity = []
    trades = []
    for i, date in enumerate(dates):
        want = target[i]
        if want != held:
            if held:
                px = opens[held][i]
                proceeds = qty * px * (1 - cost)
                trades.append({"exit": date, "symbol": held, "pnl": proceeds - entry})
                cash += proceeds
                held, qty = None, 0.0
            if want:
                px = opens[want][i]
                spend = cash
                qty = spend * (1 - cost) / px
                entry = spend
                cash = 0.0
                held = want
        mark = cash + (qty * opens[held][i] if held else 0.0)
        equity.append(mark)
    if held:
        px = opens[held][-1]
        proceeds = qty * px * (1 - cost)
        trades.append({"exit": dates[-1], "symbol": held, "pnl": proceeds - entry, "open": True})
    return equity, trades


def segment(dates: list[str], start: str, end: str) -> list[int]:
    return [i for i, d in enumerate(dates) if start <= d <= end]


def main() -> None:
    symbols = SPEC["universe"]
    raw = {s: load(s) for s in symbols}
    checksums = {s: hashlib.sha256((DATA / f"{s}.json").read_bytes()).hexdigest() for s in symbols}
    common = set(raw["SPY"][i]["date"] for i in range(len(raw["SPY"])))
    for s in symbols:
        common &= {b["date"] for b in raw[s]}
    dates = sorted(d for d in common if d >= "2009-01-01")
    series = {s: {b["date"]: b for b in raw[s]} for s in symbols}
    opens = {s: [series[s][d]["open"] for d in dates] for s in symbols}
    closes = {s: [series[s][d]["close"] for d in dates] for s in symbols}
    spy = closes["SPY"]

    # H1 monthly dual momentum. Signal known at month-end close, applied next session.
    h1 = [None] * len(dates)
    last_month = None
    choice = None
    for i, d in enumerate(dates):
        mk = month_key(d)
        if last_month and mk != last_month and i >= 252:
            spy_ret = spy[i - 1] / spy[i - 253] - 1
            tlt_ret = closes["TLT"][i - 1] / closes["TLT"][i - 253] - 1
            choice = "SPY" if spy_ret > 0 and spy_ret >= tlt_ret else "TLT" if tlt_ret > 0 else None
        h1[i] = choice
        last_month = mk

    # H2 2-ATR mean reversion. Signal at close, fill next open, hold 5 sessions.
    atr = [None] * len(dates)
    for i in range(1, len(dates)):
        tr = max(series["SPY"][dates[i]]["high"] - series["SPY"][dates[i]]["low"], abs(series["SPY"][dates[i]]["high"] - spy[i - 1]), abs(series["SPY"][dates[i]]["low"] - spy[i - 1]))
        atr[i] = tr if atr[i - 1] is None else (atr[i - 1] * 13 + tr) / 14
    h2 = [None] * len(dates)
    hold_left = 0
    for i in range(15, len(dates) - 1):
        shock = spy[i] < spy[i - 1] - 2 * (atr[i] or 0)
        if hold_left > 0:
            h2[i + 1] = "SPY"
            hold_left -= 1
        elif shock:
            h2[i + 1] = "SPY"
            hold_left = 4

    # H3 vol regime. High vol -> TLT, else SPY. Signal at close, fill next open.
    h3 = [None] * len(dates)
    vols = [None] * len(dates)
    for i in range(20, len(dates)):
        rets = [spy[j] / spy[j - 1] - 1 for j in range(i - 19, i + 1)]
        vols[i] = (sum(r * r for r in rets) / 20) ** 0.5
    for i in range(272, len(dates) - 1):
        window = [v for v in vols[i - 251:i + 1] if v is not None]
        cutoff = sorted(window)[int(0.75 * (len(window) - 1))]
        h3[i + 1] = "TLT" if vols[i] > cutoff else "SPY"

    results = {"spec": SPEC, "checksums": checksums, "candidates": {}}
    for name, target in [("dual-mom-spy-tlt-v1", h1), ("spy-mr-2atr-v1", h2), ("vol-regime-spy-tlt-v1", h3)]:
        candidate = {}
        for label, bounds in SPEC["splits"].items():
            ids = segment(dates, *bounds)
            if len(ids) < 5:
                continue
            sub_dates = [dates[i] for i in ids]
            sub_opens = {s: [opens[s][i] for i in ids] for s in symbols}
            sub_target = [target[i] for i in ids]
            eq, trades = run_targets(sub_dates, sub_opens, sub_target, COST)
            eq2, _ = run_targets(sub_dates, sub_opens, sub_target, COST * 2)
            spy_eq, _ = run_targets(sub_dates, sub_opens, ["SPY"] * len(ids), COST)
            bil_eq, _ = run_targets(sub_dates, sub_opens, ["BIL"] * len(ids), COST)
            m = metrics(eq, trades, sub_dates)
            m["twoXCostTotal"] = eq2[-1] / eq2[0] - 1
            m["spyTotal"] = spy_eq[-1] / spy_eq[0] - 1
            m["bilTotal"] = bil_eq[-1] / bil_eq[0] - 1
            m["spyMaxDd"] = metrics(spy_eq, [], sub_dates)["maxDrawdown"]
            candidate[label] = m
        val = candidate.get("validation", {})
        hold = candidate.get("holdout", {})
        gate = {
            "excessVsBil": (val.get("totalReturn", -1) - val.get("bilTotal", 0)) > 0,
            "sharpe": val.get("sharpe", 0) > 0.4,
            "profitFactor": (val.get("profitFactor") or 0) > 1.15,
            "events": val.get("trades", 0) >= 8,
            "drawdown": val.get("maxDrawdown", -1) >= val.get("spyMaxDd", -1) - 0.10,
            "twoX": val.get("twoXCostTotal", -1) > 0,
            "holdoutNet": hold.get("totalReturn", -1) > 0,
            "holdoutExcess": (hold.get("totalReturn", -1) - hold.get("bilTotal", 0)) > 0,
        }
        candidate["gate"] = gate
        candidate["verdict"] = "NO_WINNER" if not all(gate.values()) else "PASS_GATE"
        results["candidates"][name] = candidate
    results["promotion"] = False
    results["strategyApproved"] = False
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "results.json").write_text(json.dumps(results, indent=2))
    print(json.dumps({k: {s: results["candidates"][k][s] for s in ("validation", "holdout", "verdict")} for k in results["candidates"]}, indent=2))


if __name__ == "__main__":
    main()
