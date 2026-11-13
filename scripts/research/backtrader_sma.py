"""Second Backtrader check: 2/3 SMA cross on a fixed synthetic series.

Not a market result. No broker. Compared later with an independent Apex formula.
"""
import json
from datetime import datetime, timedelta, timezone

import backtrader as bt
import pandas as pd

# Independent of Backtrader. Open is the next-bar fill price the strategy expects.
BARS = [
    (10.0, 10.2, 9.8, 10.0),
    (10.0, 10.2, 9.8, 10.0),
    (10.0, 10.2, 9.8, 10.0),
    (11.0, 12.2, 10.8, 12.0),
    (12.0, 12.2, 11.8, 12.0),
    (11.0, 11.2, 8.8, 9.0),
    (9.0, 9.2, 8.8, 9.0),
    (9.0, 9.2, 8.8, 9.0),
]


class Cross(bt.Strategy):
    def __init__(self):
        self.fast = bt.indicators.SMA(self.data.close, period=2)
        self.slow = bt.indicators.SMA(self.data.close, period=3)
        self.fills = []

    def notify_order(self, order):
        if order.status == order.Completed:
            self.fills.append(
                {
                    "bar": len(self),
                    "size": order.executed.size,
                    "price": round(order.executed.price, 10),
                    "value": round(order.executed.value, 10),
                    "comm": round(order.executed.comm, 10),
                }
            )

    def next(self):
        if len(self) < 4:
            return
        prev_fast = float(self.fast[-1])
        prev_slow = float(self.slow[-1])
        fast = float(self.fast[0])
        slow = float(self.slow[0])
        if not self.position and prev_fast <= prev_slow and fast > slow:
            self.buy(size=10)
        elif self.position and prev_fast >= prev_slow and fast < slow:
            self.close()


def frame():
    start = datetime(2024, 1, 2, 14, 30, tzinfo=timezone.utc)
    rows = []
    for i, (open_, high, low, close) in enumerate(BARS):
        rows.append(
            {
                "datetime": start + timedelta(minutes=30 * i),
                "open": open_,
                "high": high,
                "low": low,
                "close": close,
                "volume": 1000,
            }
        )
    return pd.DataFrame(rows).set_index("datetime")


def main():
    cerebro = bt.Cerebro(stdstats=False)
    cerebro.adddata(bt.feeds.PandasData(dataname=frame()))
    cerebro.addstrategy(Cross)
    cerebro.broker.setcash(100000)
    cerebro.broker.setcommission(commission=0.001)
    cerebro.broker.set_coc(False)
    start = cerebro.broker.getvalue()
    strategies = cerebro.run()
    end = cerebro.broker.getvalue()
    fills = strategies[0].fills
    print(
        json.dumps(
            {
                "ok": True,
                "engine": "backtrader",
                "workflow": "sma-2-3",
                "version": bt.__version__,
                "placeOrders": False,
                "bars": BARS,
                "fills": fills,
                "startValue": start,
                "endValue": end,
                "netPnl": round(end - start, 10),
                "ranAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            }
        )
    )


if __name__ == "__main__":
    main()
