"""Backtrader equity research on Yahoo daily SPY.

OHLC is the vendor's split-adjusted, dividend-unadjusted print.
Holdout is the last 252 sessions and is not used here.
"""
import hashlib
import json
from datetime import datetime
from pathlib import Path

import backtrader as bt
import pandas as pd

ROOT = Path("/workspace")
SPY = ROOT / "research/data/raw/yahoo/20261112/SPY.json"
OUT = ROOT / "research/lab/backtrader-spy.json"


class SmaCross(bt.Strategy):
    params = (("fast", 20), ("slow", 50))

    def __init__(self):
        self.fast = bt.indicators.SMA(self.data.close, period=self.p.fast)
        self.slow = bt.indicators.SMA(self.data.close, period=self.p.slow)
        self.cross = bt.indicators.CrossOver(self.fast, self.slow)
        self.trades = []

    def next(self):
        if not self.position and self.cross > 0:
            self.buy()
        elif self.position and self.cross < 0:
            self.close()

    def notify_trade(self, trade):
        if trade.isclosed:
            self.trades.append({"pnl": round(trade.pnlcomm, 2)})


class MeanRev(bt.Strategy):
    params = (("period", 20), ("band", 1.5))

    def __init__(self):
        self.sma = bt.indicators.SMA(self.data.close, period=self.p.period)
        self.std = bt.indicators.StandardDeviation(self.data.close, period=self.p.period)
        self.trades = []

    def next(self):
        if len(self) < self.p.period:
            return
        lower = self.sma[0] - self.p.band * self.std[0]
        if not self.position and self.data.close[0] < lower:
            self.buy()
        elif self.position and self.data.close[0] > self.sma[0]:
            self.close()

    def notify_trade(self, trade):
        if trade.isclosed:
            self.trades.append({"pnl": round(trade.pnlcomm, 2)})


def load_spy():
    raw = json.loads(SPY.read_text())
    frame = pd.DataFrame(raw["bars"])
    frame["date"] = pd.to_datetime(frame["date"])
    frame = frame.set_index("date").sort_index()
    checksum = hashlib.sha256(SPY.read_bytes()).hexdigest()[:16]
    return frame[["open", "high", "low", "close", "volume"]], raw, checksum


def metrics(trades, start, end):
    wins = [t["pnl"] for t in trades if t["pnl"] > 0]
    losses = [t["pnl"] for t in trades if t["pnl"] <= 0]
    net = sum(t["pnl"] for t in trades)
    gross_win = sum(wins)
    gross_loss = abs(sum(losses))
    return {
        "tradeCount": len(trades),
        "winRate": round(len(wins) / len(trades), 4) if trades else None,
        "avgWinner": round(sum(wins) / len(wins), 2) if wins else None,
        "avgLoser": round(sum(losses) / len(losses), 2) if losses else None,
        "netPnl": round(net, 2),
        "profitFactor": round(gross_win / gross_loss, 3) if gross_loss else None,
        "startValue": start,
        "endValue": round(end, 2),
        "netReturn": round((end - start) / start, 4),
    }


def run_strategy(frame, strategy):
    cerebro = bt.Cerebro()
    cerebro.broker.setcash(100_000)
    cerebro.broker.setcommission(commission=0.0005)
    cerebro.adddata(bt.feeds.PandasData(dataname=frame))
    cerebro.addstrategy(strategy)
    result = cerebro.run()[0]
    return result, cerebro.broker.getvalue()


def main():
    frame, raw, checksum = load_spy()
    holdout_start = frame.index[-252]
    insample = frame.loc[:holdout_start].iloc[:-1]
    sma_result, sma_end = run_strategy(insample, SmaCross)
    mr_result, mr_end = run_strategy(insample, MeanRev)
    closed = metrics(sma_result.trades, 100_000, sma_end)
    mr = metrics(mr_result.trades, 100_000, mr_end)
    first = float(insample["close"].iloc[0])
    last = float(insample["close"].iloc[-1])
    bh_end = (100_000 / first) * last
    report = {
        "schemaVersion": "apex.lab.v1",
        "engine": "backtrader",
        "version": bt.__version__,
        "strategy": "sma-20-50",
        "symbol": "SPY",
        "venue": "equity",
        "dataSource": "Yahoo Finance chart API v8",
        "adjustment": raw["adjustmentPolicy"],
        "coverage": {"first": str(insample.index[0].date()), "last": str(insample.index[-1].date()), "bars": int(len(insample))},
        "holdout": {"from": str(holdout_start.date()), "bars": 252, "reason": "Last 252 sessions reserved. Not used to tune."},
        "rawLast": raw["bars"][-1]["date"],
        "checksum": checksum,
        "synthetic": False,
        "validated": False,
        "paperAutoEligible": False,
        "metrics": {
            **closed,
            "closedTradePnl": closed["netPnl"],
            "endingEquity": round(sma_end, 2),
            "equityChange": round(sma_end - 100_000, 2),
            "openPositionValue": round(sma_end - 100_000 - closed["netPnl"], 2),
            "netReturnOnEquity": round((sma_end - 100_000) / 100_000, 6),
            "buyAndHoldEnd": round(bh_end, 2),
            "buyAndHoldReturn": round((bh_end - 100_000) / 100_000, 4),
            "cashBenchmark": 100_000,
        },
        "meanReversion": mr,
        "accounting": "closedTradePnl sums closed trade.pnlcomm. equityChange includes any open position. Dividends are not in the price. Commission is 5 bps. Holdout was not used.",
        "note": "Not a profitability claim. Opening-range cost study is unchanged. T1 and T2 stay IDEA.",
        "ranAt": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(report, indent=2))
    print(json.dumps({"ok": True, "smaClosed": closed["netPnl"], "smaEquity": round(sma_end - 100_000, 2), "meanRevClosed": mr["netPnl"], "bh": report["metrics"]["buyAndHoldReturn"]}))


if __name__ == "__main__":
    main()
