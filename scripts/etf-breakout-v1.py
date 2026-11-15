#!/usr/bin/env python3
"""
US ETF trend-following breakout backtest.
Frozen specification — do not optimize on the holdout.

Universe: SPY, QQQ, IWM
Entry: 20-day closing-price breakout excluding the signal day's close.
       SPY and candidate above their 200-day SMAs.
       Select the eligible ETF with the highest trailing 60-day return.
Exit: close below the preceding 10-day low, or close below the 50-day SMA.
Signals after regular-session close. Fill no earlier than the next regular-session open.
Long-only, one position maximum, no leverage.
Starting capital $100, position cap $25.

Data: Yahoo chart v8 daily bars. OHLC are split-adjusted, dividend-unadjusted.
      Dividends credited as cash on ex-date. yahooAdjClose is not used for signals.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

ROOT = Path("/workspace")
DATA = ROOT / "research/data/raw/yahoo/20261112"
OUT = ROOT / "research/lab/etf-breakout-v1"

# Frozen before any holdout inspection.
SPEC = {
    "name": "etf-xs-breakout-20-v1",
    "universe": ["SPY", "QQQ", "IWM"],
    "breakout_days": 20,
    "trend_sma": 200,
    "rank_days": 60,
    "exit_low_days": 10,
    "exit_sma": 50,
    "start_capital": 100.0,
    "position_cap": 25.0,
    "slippage_bps": 2.0,
    "commission_bps": 0.0,
    "max_chase_pct": 0.005,
    "warmup_start": "2016-01-01",
    "development": ["2017-01-03", "2021-12-31"],
    "validation": ["2022-01-03", "2024-12-31"],
    "holdout": ["2025-01-02", "2026-11-11"],
    "source": "yahoo-chart-v8",
    "adjustment": "OHLC split-adjusted, dividend-unadjusted; dividends credited as cash",
}


def load(symbol: str) -> dict:
    path = DATA / f"{symbol}.json"
    raw = path.read_bytes()
    doc = json.loads(raw)
    bars = [b for b in doc["bars"] if b["date"] >= SPEC["warmup_start"]]
    divs = {d["exDate"]: d["amount"] for d in doc.get("dividends", [])}
    return {
        "symbol": symbol,
        "bars": bars,
        "dividends": divs,
        "checksum": hashlib.sha256(raw).hexdigest(),
        "first": doc["bars"][0]["date"],
        "last": doc["bars"][-1]["date"],
        "count": len(doc["bars"]),
        "policy": doc.get("adjustmentPolicy"),
    }


def sma(values: list[float], n: int) -> float | None:
    if len(values) < n:
        return None
    return sum(values[-n:]) / n


def metrics(equity: list[tuple[str, float]], start: float) -> dict:
    if len(equity) < 2:
        return {"cagr": 0, "total": 0, "max_dd": 0, "sharpe": 0, "sortino": 0, "trades": 0}
    rets = []
    peak = equity[0][1]
    max_dd = 0.0
    for i in range(1, len(equity)):
        prev, cur = equity[i - 1][1], equity[i][1]
        rets.append(cur / prev - 1 if prev else 0)
        peak = max(peak, cur)
        max_dd = min(max_dd, cur / peak - 1)
    years = (len(equity) - 1) / 252
    total = equity[-1][1] / start - 1
    cagr = (equity[-1][1] / start) ** (1 / years) - 1 if years > 0 and equity[-1][1] > 0 else -1
    mean = sum(rets) / len(rets)
    var = sum((r - mean) ** 2 for r in rets) / len(rets)
    std = var ** 0.5
    downside = [r for r in rets if r < 0]
    dstd = (sum(r * r for r in downside) / len(rets)) ** 0.5 if rets else 0
    sharpe = (mean / std) * (252 ** 0.5) if std else 0
    sortino = (mean / dstd) * (252 ** 0.5) if dstd else 0
    return {
        "cagr": round(cagr, 4),
        "total": round(total, 4),
        "max_dd": round(max_dd, 4),
        "sharpe": round(sharpe, 3),
        "sortino": round(sortino, 3),
        "end_equity": round(equity[-1][1], 4),
    }


def run(books: dict[str, dict], start: str, end: str, slip_bps: float) -> dict:
    # Align on SPY calendar.
    spy_dates = [b["date"] for b in books["SPY"]["bars"] if start <= b["date"] <= end]
    idx = {s: {b["date"]: i for i, b in enumerate(books[s]["bars"])} for s in books}
    cash = SPEC["start_capital"]
    pos = None  # {symbol, qty, entry}
    equity = []
    trades = []
    unfilled = 0
    slip = slip_bps / 10000
    comm = SPEC["commission_bps"] / 10000

    def bar(sym: str, date: str):
        i = idx[sym].get(date)
        return books[sym]["bars"][i] if i is not None else None

    def closes(sym: str, date: str, n: int):
        i = idx[sym].get(date)
        if i is None or i + 1 < n:
            return None
        return [books[sym]["bars"][j]["close"] for j in range(i - n + 1, i + 1)]

    def lows(sym: str, date: str, n: int):
        i = idx[sym].get(date)
        if i is None or i < n:
            return None
        return [books[sym]["bars"][j]["low"] for j in range(i - n, i)]

    for di, date in enumerate(spy_dates):
        # Mark and manage at today's close; fills were at today's open from yesterday's signal.
        for sym in SPEC["universe"]:
            b = bar(sym, date)
            if not b:
                continue
            if pos and pos["symbol"] == sym:
                div = books[sym]["dividends"].get(date, 0)
                if div:
                    cash += pos["qty"] * div
        mtm = cash
        if pos:
            b = bar(pos["symbol"], date)
            if b:
                mtm += pos["qty"] * b["close"]
        equity.append((date, mtm))

        # Exit decision at close, fill next open.
        if pos and di + 1 < len(spy_dates):
            sym = pos["symbol"]
            b = bar(sym, date)
            c20 = closes(sym, date, SPEC["exit_sma"])
            prior_lows = lows(sym, date, SPEC["exit_low_days"])
            exit_sma = sma(c20, SPEC["exit_sma"]) if c20 else None
            exit_low = min(prior_lows) if prior_lows else None
            if b and exit_sma and exit_low and (b["close"] < exit_low or b["close"] < exit_sma):
                nxt = spy_dates[di + 1]
                nb = bar(sym, nxt)
                if nb:
                    px = nb["open"] * (1 - slip)
                    proceeds = pos["qty"] * px
                    fee = proceeds * comm
                    cash += proceeds - fee
                    trades.append({"exit": nxt, "symbol": sym, "px": round(px, 4), "pnl": round(proceeds - fee - pos["cost"], 4)})
                    pos = None

        # Entry decision at close, fill next open. One position max.
        if pos is None and di + 1 < len(spy_dates):
            spy_c = closes("SPY", date, SPEC["trend_sma"])
            spy_sma = sma(spy_c, SPEC["trend_sma"]) if spy_c else None
            spy_bar = bar("SPY", date)
            if not spy_sma or not spy_bar or spy_bar["close"] <= spy_sma:
                continue
            candidates = []
            for sym in SPEC["universe"]:
                c200 = closes(sym, date, SPEC["trend_sma"])
                c20 = closes(sym, date, SPEC["breakout_days"] + 1)
                c60 = closes(sym, date, SPEC["rank_days"] + 1)
                sma200 = sma(c200, SPEC["trend_sma"]) if c200 else None
                if not (c20 and c60 and sma200):
                    continue
                today = c20[-1]
                channel = max(c20[:-1])  # exclude signal day's close
                if today > channel and today > sma200:
                    rank = today / c60[0] - 1
                    candidates.append((rank, sym, today))
            if not candidates:
                continue
            candidates.sort(reverse=True)
            _, sym, signal_close = candidates[0]
            nxt = spy_dates[di + 1]
            nb = bar(sym, nxt)
            if not nb:
                unfilled += 1
                continue
            if nb["open"] > signal_close * (1 + SPEC["max_chase_pct"]):
                unfilled += 1
                continue
            px = nb["open"] * (1 + slip)
            notional = min(SPEC["position_cap"], cash)
            if notional < 1:
                continue
            qty = notional / px
            fee = notional * comm
            cost = qty * px + fee
            if cost > cash:
                continue
            cash -= cost
            pos = {"symbol": sym, "qty": qty, "cost": cost, "entry": nxt}

    wins = [t for t in trades if t["pnl"] > 0]
    losses = [t for t in trades if t["pnl"] <= 0]
    gross_win = sum(t["pnl"] for t in wins)
    gross_loss = abs(sum(t["pnl"] for t in losses))
    pf = gross_win / gross_loss if gross_loss else None
    expectancy = sum(t["pnl"] for t in trades) / len(trades) if trades else 0
    m = metrics(equity, SPEC["start_capital"])
    by_year: dict[str, float] = {}
    year_start = {}
    for d, e in equity:
        y = d[:4]
        year_start.setdefault(y, e)
        by_year[y] = e
    yearly = {y: round(by_year[y] / year_start[y] - 1, 4) for y in by_year}
    return {
        **m,
        "trades": len(trades),
        "win_rate": round(len(wins) / len(trades), 3) if trades else 0,
        "profit_factor": round(pf, 3) if pf is not None else None,
        "expectancy": round(expectancy, 4),
        "unfilled": unfilled,
        "turnover": len(trades),
        "yearly": yearly,
        "trade_list": trades,
    }


def spy_buy_hold(books: dict, start: str, end: str) -> dict:
    bars = [b for b in books["SPY"]["bars"] if start <= b["date"] <= end]
    cash = SPEC["start_capital"]
    px = bars[0]["open"]
    qty = cash / px
    cash = 0
    equity = []
    for b in bars:
        div = books["SPY"]["dividends"].get(b["date"], 0)
        cash += qty * div
        equity.append((b["date"], cash + qty * b["close"]))
    return metrics(equity, SPEC["start_capital"])


def spy_sma200(books: dict, start: str, end: str) -> dict:
    bars = books["SPY"]["bars"]
    idx = {b["date"]: i for i, b in enumerate(bars)}
    dates = [b["date"] for b in bars if start <= b["date"] <= end]
    cash = SPEC["start_capital"]
    qty = 0.0
    equity = []
    for di, date in enumerate(dates):
        i = idx[date]
        b = bars[i]
        if qty and date in books["SPY"]["dividends"]:
            cash += qty * books["SPY"]["dividends"][date]
        equity.append((date, cash + qty * b["close"]))
        if i < 200 or di + 1 >= len(dates):
            continue
        sma_v = sum(bars[j]["close"] for j in range(i - 199, i + 1)) / 200
        nxt = dates[di + 1]
        nb = bars[idx[nxt]]
        if qty == 0 and b["close"] > sma_v:
            px = nb["open"] * 1.0002
            qty = min(SPEC["position_cap"], cash) / px
            cash -= qty * px
        elif qty and b["close"] < sma_v:
            px = nb["open"] * 0.9998
            cash += qty * px
            qty = 0
    return metrics(equity, SPEC["start_capital"])


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    books = {s: load(s) for s in SPEC["universe"]}
    provenance = {
        "spec": SPEC,
        "symbols": {s: {k: books[s][k] for k in ("checksum", "first", "last", "count", "policy")} for s in books},
    }
    results = {"spec": SPEC, "provenance": provenance, "segments": {}}
    for name, (a, b) in (("development", SPEC["development"]), ("validation", SPEC["validation"]), ("holdout", SPEC["holdout"])):
        strat = run(books, a, b, SPEC["slippage_bps"])
        strat_2x = run(books, a, b, SPEC["slippage_bps"] * 2)
        bh = spy_buy_hold(books, a, b)
        base = spy_sma200(books, a, b)
        results["segments"][name] = {
            "strategy": {k: v for k, v in strat.items() if k != "trade_list"},
            "strategy_2x_costs": {k: v for k, v in strat_2x.items() if k != "trade_list"},
            "spy_buy_hold": bh,
            "spy_sma200_capped": base,
            "trades": strat["trade_list"],
        }
    (OUT / "results.json").write_text(json.dumps(results, indent=2))
    print(json.dumps({k: results["segments"][k]["strategy"] for k in results["segments"]}, indent=2))


if __name__ == "__main__":
    main()
