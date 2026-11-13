"""Versioned portfolio-sized 12-1 momentum. Not the one-share baseline.

Variant id: mom-12-1-v2-equity95
Sizing: 95 percent of equity, one position. Holdout unused.
"""
import json
from datetime import datetime, timezone
from pathlib import Path

import backtrader as bt
import pandas as pd

OUT = Path("/workspace/research/lab/momentum-12-1-v2.json")


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
        signal = past / older - 1
        if not self.position and signal > 0:
            self.order_target_percent(target=0.95)
        elif self.position and signal <= 0:
            self.close()

    def notify_order(self, order):
        if order.status == order.Completed:
            self.fills.append({"dt": self.data.datetime.date(0).isoformat(), "size": order.executed.size, "price": round(order.executed.price, 4), "comm": round(order.executed.comm, 4)})


def main():
    raw = json.loads(Path("/workspace/research/data/raw/yahoo/20261112/SPY.json").read_text())
    frame = pd.DataFrame(raw["bars"])
    frame["date"] = pd.to_datetime(frame["date"])
    frame = frame.set_index("date").sort_index()[["open", "high", "low", "close", "volume"]]
    holdout = frame.index[-252]
    sample = frame.loc[:holdout].iloc[:-1]
    cerebro = bt.Cerebro()
    cerebro.broker.setcash(100_000)
    cerebro.broker.setcommission(commission=0.0005)
    cerebro.broker.set_slippage_perc(0.0001)
    cerebro.adddata(bt.feeds.PandasData(dataname=sample))
    cerebro.addstrategy(Mom)
    cerebro.run()
    end = cerebro.broker.getvalue()
    first, last = float(sample["close"].iloc[0]), float(sample["close"].iloc[-1])
    bh = (100_000 / first) * last
    report = {
        "variant": "mom-12-1-v2-equity95",
        "baseline": "mom-12-1 one-share, unchanged",
        "sizing": "95 percent of equity",
        "costs": "5 bps commission plus 1 bp slippage",
        "holdoutFrom": str(holdout.date()),
        "holdoutUsed": False,
        "endingEquity": round(end, 2),
        "netReturn": round(end / 100_000 - 1, 4),
        "buyAndHoldReturn": round(bh / 100_000 - 1, 4),
        "promoted": False,
        "note": "Versioned research variant. Not a promotion. One-share baseline is unchanged.",
        "ranAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    OUT.write_text(json.dumps(report, indent=2))
    print(json.dumps({"end": report["endingEquity"], "ret": report["netReturn"], "bh": report["buyAndHoldReturn"]}))


if __name__ == "__main__":
    main()
