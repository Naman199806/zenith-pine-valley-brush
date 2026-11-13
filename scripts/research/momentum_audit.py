"""Audit of the frozen 12-1 SPY momentum run.

Rules were locked before the first evaluation. Holdout is unused.
Two engines: Backtrader and an independent pure-Python fill model.
"""
import hashlib
import json
import math
from datetime import datetime, timezone
from pathlib import Path

import backtrader as bt
import pandas as pd

ROOT = Path("/workspace")
SPY = ROOT / "research/data/raw/yahoo/20261112/SPY.json"
OUT = ROOT / "research/lab/momentum-12-1-audit.json"
TRADES = ROOT / "research/lab/momentum-12-1-trades.json"


def load():
    raw = json.loads(SPY.read_text())
    frame = pd.DataFrame(raw["bars"])
    frame["date"] = pd.to_datetime(frame["date"])
    frame = frame.set_index("date").sort_index()
    checksum = hashlib.sha256(SPY.read_bytes()).hexdigest()[:16]
    return frame[["open", "high", "low", "close", "volume"]], raw, checksum


class Mom(bt.Strategy):
    def __init__(self):
        self.fills = []

    def next(self):
        if len(self) < 273:
            return
        past = self.data.close[-21]
        older = self.data.close[-252]
        if older <= 0:
            return
        if not self.position and past / older - 1 > 0:
            self.buy()
        elif self.position and past / older - 1 <= 0:
            self.close()

    def notify_order(self, order):
        if order.status == order.Completed:
            self.fills.append(
                {
                    "dt": self.data.datetime.date(0).isoformat(),
                    "size": order.executed.size,
                    "price": round(order.executed.price, 4),
                    "comm": round(order.executed.comm, 4),
                }
            )


def sharpe(returns):
    if len(returns) < 2:
        return None
    mean = sum(returns) / len(returns)
    var = sum((r - mean) ** 2 for r in returns) / (len(returns) - 1)
    std = math.sqrt(var)
    if std == 0:
        return None
    return round((mean / std) * math.sqrt(252), 3)


def max_dd(equity):
    peak = equity[0]
    worst = 0.0
    for value in equity:
        peak = max(peak, value)
        worst = min(worst, value / peak - 1)
    return round(worst, 4)


def independent(frame, full_equity=False):
    """Next-bar open fills, 5 bps. full_equity=False matches Backtrader's default 1-share sizer."""
    closes = frame["close"].tolist()
    opens = frame["open"].tolist()
    dates = [d.date().isoformat() for d in frame.index]
    cash = 100_000.0
    shares = 0.0
    entry = None
    trades = []
    equity = []
    invested_days = 0
    for i in range(273, len(frame) - 1):
        signal = closes[i - 21] / closes[i - 252] - 1 if closes[i - 252] > 0 else 0
        fill = opens[i + 1]
        if shares == 0 and signal > 0 and cash > fill:
            qty = (cash * (1 - 0.0005) / fill) if full_equity else 1.0
            cost = qty * fill * (1 + 0.0005)
            if cost <= cash:
                cash -= cost
                shares = qty
                entry = fill
        elif shares > 0 and signal <= 0:
            proceeds = shares * fill * (1 - 0.0005)
            trades.append({"entry": round(entry, 4), "exit": round(fill, 4), "pnl": round(proceeds - entry * shares, 2), "exitDate": dates[i + 1]})
            cash += proceeds
            shares = 0.0
            entry = None
        mark = cash + shares * closes[i]
        equity.append(mark)
        if shares > 0:
            invested_days += 1
    end = cash + shares * closes[-1]
    return trades, equity, end, invested_days


def main():
    frame, raw, checksum = load()
    holdout = frame.index[-252]
    sample = frame.loc[:holdout].iloc[:-1]
    cerebro = bt.Cerebro()
    cerebro.broker.setcash(100_000)
    cerebro.broker.setcommission(commission=0.0005)
    cerebro.adddata(bt.feeds.PandasData(dataname=sample))
    cerebro.addstrategy(Mom)
    result = cerebro.run()[0]
    bt_end = cerebro.broker.getvalue()
    # Pair fills into round trips.
    fills = result.fills
    trips = []
    open_leg = None
    for fill in fills:
        if fill["size"] > 0 and open_leg is None:
            open_leg = fill
        elif fill["size"] < 0 and open_leg is not None:
            pnl = (fill["price"] - open_leg["price"]) * open_leg["size"] - open_leg["comm"] - fill["comm"]
            trips.append({"entryDate": open_leg["dt"], "exitDate": fill["dt"], "entry": open_leg["price"], "exit": fill["price"], "pnl": round(pnl, 2)})
            open_leg = None
    wins = [t["pnl"] for t in trips if t["pnl"] > 0]
    losses = [t["pnl"] for t in trips if t["pnl"] <= 0]
    pf = round(sum(wins) / abs(sum(losses)), 3) if losses and sum(losses) else None
    ind_trades, ind_equity, ind_end, invested = independent(sample, full_equity=False)
    full_trades, full_equity, full_end, full_invested = independent(sample, full_equity=True)
    years = (sample.index[-1] - sample.index[0]).days / 365.25
    cagr = round((bt_end / 100_000) ** (1 / years) - 1, 4) if years > 0 else None
    first, last = float(sample["close"].iloc[0]), float(sample["close"].iloc[-1])
    bh_end = (100_000 / first) * last
    report = {
        "rulesFrozen": True,
        "holdoutFrom": str(holdout.date()),
        "holdoutUsed": False,
        "coverage": {"first": str(sample.index[0].date()), "last": str(sample.index[-1].date()), "bars": len(sample)},
        "checksum": checksum,
        "backtrader": {
            "tradeCount": len(trips),
            "closedPnl": round(sum(t["pnl"] for t in trips), 2),
            "profitFactor": pf,
            "winRate": round(len(wins) / len(trips), 4) if trips else None,
            "endingEquity": round(bt_end, 2),
            "netReturn": round(bt_end / 100_000 - 1, 4),
            "cagr": cagr,
        },
        "independentOneShare": {
            "tradeCount": len(ind_trades),
            "closedPnl": round(sum(t["pnl"] for t in ind_trades), 2),
            "endingEquity": round(ind_end, 2),
            "netReturn": round(ind_end / 100_000 - 1, 4),
            "maxDrawdown": max_dd(ind_equity) if ind_equity else None,
            "sharpe": sharpe([ind_equity[i] / ind_equity[i - 1] - 1 for i in range(1, len(ind_equity))]) if len(ind_equity) > 2 else None,
            "investedFraction": round(invested / max(len(ind_equity), 1), 4),
        },
        "fullEquitySensitivity": {
            "note": "Not the audited baseline. Same rules, full-equity sizing. Not used for promotion.",
            "tradeCount": len(full_trades),
            "endingEquity": round(full_end, 2),
            "netReturn": round(full_end / 100_000 - 1, 4),
            "investedFraction": round(full_invested / max(len(full_equity), 1), 4),
        },
        "buyAndHold": {"end": round(bh_end, 2), "return": round(bh_end / 100_000 - 1, 4)},
        "cash": 100_000,
        "lean": {"status": "BLOCKED", "reason": "LEAN runtime is fixture-only. Yahoo daily is not in LEAN data format. No LEAN SPY result was fabricated."},
        "promoted": False,
        "ranAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    OUT.write_text(json.dumps(report, indent=2))
    TRADES.write_text(json.dumps({"backtrader": trips, "independent": ind_trades}, indent=2))
    print(json.dumps({"btTrades": len(trips), "btPf": pf, "btEnd": round(bt_end, 2), "indTrades": len(ind_trades), "indEnd": round(ind_end, 2), "fullEnd": round(full_end, 2), "bh": report["buyAndHold"]["return"]}))


if __name__ == "__main__":
    main()
