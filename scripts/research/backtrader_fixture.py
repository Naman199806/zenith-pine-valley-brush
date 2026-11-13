"""Isolated Backtrader process. Not imported by the TypeScript app.

The three bars and the 10 bp cost are the Apex fixture, not a market result.
This process has no broker credentials and cannot submit an order.
"""
import json
from datetime import datetime, timezone

import backtrader as bt


BARS = [
    ("2024-01-02T14:30:00.000Z", 100.00, 101.00, 99.00, 100.50, 1000),
    ("2024-01-02T15:00:00.000Z", 100.80, 102.00, 100.40, 101.50, 1100),
    ("2024-01-02T15:30:00.000Z", 101.20, 101.80, 100.90, 101.00, 900),
]


class Feed(bt.feeds.PandasData):
    pass


class UpBar(bt.Strategy):
    def next(self):
        if len(self) == 1 and self.data.close[0] > self.data.open[0] and not self.position:
            self.buy(size=100)
        elif self.position and len(self) == 2:
            self.close()


def frame():
    import pandas as pd

    rows = []
    for ts, open_, high, low, close, volume in BARS:
        rows.append(
            {
                "datetime": datetime.fromisoformat(ts.replace("Z", "+00:00")),
                "open": open_,
                "high": high,
                "low": low,
                "close": close,
                "volume": volume,
            }
        )
    return pd.DataFrame(rows).set_index("datetime")


def main():
    try:
        import pandas as pd  # noqa: F401
    except ImportError:
        print(json.dumps({"ok": False, "reason": "pandas is not installed in the backtrader runtime"}))
        return
    cerebro = bt.Cerebro(stdstats=False)
    cerebro.adddata(bt.feeds.PandasData(dataname=frame()))
    cerebro.addstrategy(UpBar)
    cerebro.broker.setcash(1_000_000)
    cerebro.broker.setcommission(commission=0.001)
    cerebro.broker.set_coc(False)
    start = cerebro.broker.getvalue()
    cerebro.run()
    end = cerebro.broker.getvalue()
    print(
        json.dumps(
            {
                "ok": True,
                "engine": "backtrader",
                "version": bt.__version__,
                "placeOrders": False,
                "startValue": start,
                "endValue": end,
                "netPnl": round(end - start, 10),
                "expectedNetDollars": 19.8,
                "ranAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            }
        )
    )


if __name__ == "__main__":
    main()
