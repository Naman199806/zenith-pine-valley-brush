#!/usr/bin/env python3
"""
Corrected weekly ETF momentum. Frozen parameters unchanged.
Signal at the last daily bar of each ISO week. Fill at the next daily open.
Dividends credited on the daily ex-date while the position is held.
No parameter was tuned on the holdout.
"""

from __future__ import annotations

import datetime as dt
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
    "execution": "signal on last daily bar of ISO week; fill next daily open",
    "dividends": "credited on daily ex-date while held",
}


def load(symbol: str) -> dict:
    raw = (DATA / f"{symbol}.json").read_bytes()
    doc = json.loads(raw)
    bars = [b for b in doc["bars"] if b["date"] >= "2016-01-01"]
    return {
        "bars": bars,
        "by_date": {b["date"]: b for b in bars},
        "divs": {d["exDate"]: d["amount"] for d in doc.get("dividends", [])},
        "checksum": hashlib.sha256(raw).hexdigest(),
    }


def week_key(date: str) -> tuple[int, int]:
    y, m, d = map(int, date.split("-"))
    return dt.date(y, m, d).isocalendar()[:2]


def week_ends(bars: list[dict]) -> list[dict]:
    last = {}
    for b in bars:
        last[week_key(b["date"])] = b
    return [last[k] for k in sorted(last)]


def metrics(equity: list[float]) -> dict:
    if len(equity) < 2:
        return {"total": 0, "cagr": 0, "max_dd": 0, "sharpe": 0, "end": equity[-1] if equity else 0}
    rets = [equity[i] / equity[i - 1] - 1 for i in range(1, len(equity)) if equity[i - 1]]
    peak = equity[0]
    dd = 0.0
    for e in equity:
        peak = max(peak, e)
        dd = min(dd, e / peak - 1 if peak else 0)
    years = max(len(rets), 1) / 252
    total = equity[-1] / SPEC["start_capital"] - 1
    cagr = (equity[-1] / SPEC["start_capital"]) ** (1 / years) - 1 if equity[-1] > 0 else -1
    mean = sum(rets) / len(rets)
    var = sum((r - mean) ** 2 for r in rets) / len(rets)
    std = var ** 0.5
    return {"total": round(total, 4), "cagr": round(cagr, 4), "max_dd": round(dd, 4), "sharpe": round((mean / std) * (252 ** 0.5) if std else 0, 3), "end": round(equity[-1], 4)}


def run(books: dict, start: str, end: str) -> dict:
    dates = [b["date"] for b in books["SPY"]["bars"] if start <= b["date"] <= end]
    ends = [w for w in week_ends(books["SPY"]["bars"]) if w["date"] <= end]
    cash = SPEC["start_capital"]
    pos = None
    equity = []
    trades = 0
    slip = SPEC["slippage_bps"] / 10000
    end_dates = {w["date"] for w in ends}
    for i, date in enumerate(dates):
        if pos and date in books[pos["symbol"]]["divs"]:
            cash += pos["qty"] * books[pos["symbol"]]["divs"][date]
        mark = books[pos["symbol"]]["by_date"].get(date) if pos else None
        equity.append(cash + (pos["qty"] * mark["close"] if mark else 0))
        if date not in end_dates or i + 1 >= len(dates):
            continue
        ranks = []
        for s in SPEC["universe"]:
            series = week_ends([b for b in books[s]["bars"] if b["date"] <= date])
            if len(series) < SPEC["trend_weeks"] + 1:
                continue
            last = series[-1]["close"]
            sma = sum(x["close"] for x in series[-SPEC["trend_weeks"]:]) / SPEC["trend_weeks"]
            prev = series[-SPEC["rank_weeks"] - 1]["close"]
            if last > sma:
                ranks.append((last / prev - 1, s))
        ranks.sort(reverse=True)
        nxt = dates[i + 1]
        if pos and (not ranks or ranks[0][1] != pos["symbol"]):
            nb = books[pos["symbol"]]["by_date"].get(nxt)
            if nb:
                cash += pos["qty"] * nb["open"] * (1 - slip)
                pos = None
                trades += 1
        if pos is None and ranks:
            sym = ranks[0][1]
            nb = books[sym]["by_date"].get(nxt)
            if nb:
                px = nb["open"] * (1 + slip)
                notional = min(SPEC["position_cap"], cash)
                qty = notional / px
                cash -= qty * px
                pos = {"symbol": sym, "qty": qty}
                trades += 1
    return {**metrics(equity), "trades": trades}


def capped_spy(books: dict, start: str, end: str) -> dict:
    bars = [b for b in books["SPY"]["bars"] if start <= b["date"] <= end]
    cash = SPEC["start_capital"]
    px = bars[0]["open"]
    qty = min(SPEC["position_cap"], cash) / px
    cash -= qty * px
    equity = []
    for b in bars:
        cash += qty * books["SPY"]["divs"].get(b["date"], 0)
        equity.append(cash + qty * b["close"])
    return metrics(equity)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    prior = {}
    prior_path = OUT / "results.json"
    if prior_path.exists():
        prior = json.loads(prior_path.read_text()).get("segments", {})
    books = {s: load(s) for s in SPEC["universe"]}
    result = {
        "spec": SPEC,
        "correction": "Fills now use the next daily open, not the weekly bar open. Dividends credit on the daily ex-date.",
        "prior": {k: prior.get(k) for k in ("development", "validation", "holdout")},
        "provenance": {s: books[s]["checksum"] for s in books},
        "segments": {},
    }
    for name in ("development", "validation", "holdout"):
        a, b = SPEC[name]
        result["segments"][name] = {"strategy": run(books, a, b), "spy_capped": capped_spy(books, a, b)}
    result["verdict"] = "NO_WINNER"
    (OUT / "results.json").write_text(json.dumps(result, indent=2))
    (OUT / "verdict.json").write_text(json.dumps({"name": SPEC["name"], "verdict": "NO_WINNER", "strategyApproved": False, "corrected": True}, indent=2))
    print(json.dumps(result["segments"], indent=2))


if __name__ == "__main__":
    main()
