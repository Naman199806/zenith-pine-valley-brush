#!/usr/bin/env python3
"""
Frozen weekly ETF momentum rotation. Independent of etf-xs-breakout-20-v1.
Universe SPY, QQQ, IWM. Friday close rank, next session open fill.
Hold the highest trailing 12-week return if it is above its 40-week SMA.
Else cash. One position. $100 capital, $25 cap. 2 bps slippage.
Development 2017-2021, validation 2022-2024, holdout 2025-2026 evaluated once.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

ROOT = Path("/workspace")
DATA = ROOT / "research/data/raw/yahoo/20261112"
OUT = ROOT / "research/lab/etf-weekly-momentum-v1"
SPEC = {
    "name": "etf-weekly-momentum-v1",
    "universe": ["SPY", "QQQ", "IWM"],
    "rank_weeks": 12,
    "trend_weeks": 40,
    "start_capital": 100.0,
    "position_cap": 25.0,
    "slippage_bps": 2.0,
    "development": ["2017-01-03", "2021-12-31"],
    "validation": ["2022-01-03", "2024-12-31"],
    "holdout": ["2025-01-02", "2026-11-11"],
}


def load(symbol: str) -> dict:
    raw = (DATA / f"{symbol}.json").read_bytes()
    doc = json.loads(raw)
    return {"bars": doc["bars"], "divs": {d["exDate"]: d["amount"] for d in doc.get("dividends", [])}, "checksum": hashlib.sha256(raw).hexdigest()}


def weekly(bars: list[dict]) -> list[dict]:
    out = []
    for b in bars:
        if len(b["date"]) < 10:
            continue
        # Friday or last available in week is approximated by weekday via date; use ISO week end by keeping last bar of each week.
        out.append(b)
    weeks = {}
    for b in out:
        y, m, d = map(int, b["date"].split("-"))
        import datetime
        dt = datetime.date(y, m, d)
        key = dt.isocalendar()[:2]
        weeks[key] = b
    return [weeks[k] for k in sorted(weeks)]


def metrics(equity: list[float]) -> dict:
    if len(equity) < 2:
        return {"total": 0, "cagr": 0, "max_dd": 0, "sharpe": 0}
    rets = [equity[i] / equity[i - 1] - 1 for i in range(1, len(equity))]
    peak = equity[0]
    dd = 0
    for e in equity:
        peak = max(peak, e)
        dd = min(dd, e / peak - 1)
    years = len(rets) / 52
    total = equity[-1] / equity[0] - 1
    cagr = (equity[-1] / equity[0]) ** (1 / years) - 1 if years and equity[-1] > 0 else -1
    mean = sum(rets) / len(rets)
    var = sum((r - mean) ** 2 for r in rets) / len(rets)
    std = var ** 0.5
    sharpe = (mean / std) * (52 ** 0.5) if std else 0
    return {"total": round(total, 4), "cagr": round(cagr, 4), "max_dd": round(dd, 4), "sharpe": round(sharpe, 3), "end": round(equity[-1], 4)}


def run(books: dict, start: str, end: str) -> dict:
    weeks = {s: [w for w in weekly(books[s]["bars"]) if "2016-01-01" <= w["date"] <= end] for s in SPEC["universe"]}
    spy = [w for w in weeks["SPY"] if start <= w["date"] <= end]
    cash = SPEC["start_capital"]
    pos = None
    equity = [cash]
    trades = 0
    slip = SPEC["slippage_bps"] / 10000
    for i, w in enumerate(spy[:-1]):
        date = w["date"]
        for s in SPEC["universe"]:
            if pos and pos["symbol"] == s:
                cash += pos["qty"] * books[s]["divs"].get(date, 0)
        mtm = cash + (pos["qty"] * next(x["close"] for x in weeks[pos["symbol"]] if x["date"] == date) if pos else 0)
        # rank at this week's close
        ranks = []
        for s in SPEC["universe"]:
            series = [x for x in weeks[s] if x["date"] <= date]
            if len(series) < SPEC["trend_weeks"] + 1:
                continue
            last = series[-1]["close"]
            sma = sum(x["close"] for x in series[-SPEC["trend_weeks"]:]) / SPEC["trend_weeks"]
            ret = last / series[-SPEC["rank_weeks"] - 1]["close"] - 1
            if last > sma:
                ranks.append((ret, s, last))
        ranks.sort(reverse=True)
        nxt = spy[i + 1]
        if pos:
            held = next((x for x in weeks[pos["symbol"]] if x["date"] == nxt["date"]), None)
            still = ranks and ranks[0][1] == pos["symbol"]
            if held and not still:
                px = held["open"] * (1 - slip)
                cash += pos["qty"] * px
                pos = None
                trades += 1
        if pos is None and ranks:
            sym = ranks[0][1]
            nb = next((x for x in weeks[sym] if x["date"] == nxt["date"]), None)
            if nb:
                px = nb["open"] * (1 + slip)
                notional = min(SPEC["position_cap"], cash)
                qty = notional / px
                cash -= qty * px
                pos = {"symbol": sym, "qty": qty}
                trades += 1
        mark = next((x for x in weeks[pos["symbol"]] if x["date"] == nxt["date"]), None) if pos else None
        equity.append(cash + (pos["qty"] * mark["close"] if mark else 0))
    return {**metrics(equity), "trades": trades}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    books = {s: load(s) for s in SPEC["universe"]}
    result = {"spec": SPEC, "provenance": {s: books[s]["checksum"] for s in books}, "segments": {}}
    for name in ("development", "validation", "holdout"):
        a, b = SPEC[name]
        result["segments"][name] = run(books, a, b)
    (OUT / "results.json").write_text(json.dumps(result, indent=2))
    print(json.dumps(result["segments"], indent=2))


if __name__ == "__main__":
    main()
