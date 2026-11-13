"""Reconcile LEAN and Backtrader 95 percent runs. Does not change the frozen one-share baseline."""
import json
from datetime import datetime, timezone
from pathlib import Path

import backtrader as bt
import pandas as pd

LEAN = Path("/workspace/.runtimes/lean-run/results/ApexMomentumAlgorithm-order-events.json")
OUT = Path("/workspace/research/lab/momentum-reconcile.json")


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
            self.fills.append(
                {
                    "dt": self.data.datetime.date(0).isoformat(),
                    "size": round(order.executed.size, 4),
                    "price": round(order.executed.price, 4),
                    "comm": round(order.executed.comm, 4),
                }
            )


def lean_fills():
    events = json.loads(LEAN.read_text())
    return [
        {
            "time": event["time"],
            "price": event["fillPrice"],
            "qty": event["fillQuantity"],
            "fee": event.get("orderFeeAmount", 0),
            "side": event["direction"],
        }
        for event in events
        if event.get("status") == "filled"
    ]


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
    result = cerebro.run()[0]
    bt_end = cerebro.broker.getvalue()
    lean = lean_fills()
    report = {
        "baselineUnchanged": "mom-12-1 one-share",
        "holdoutFrom": str(holdout.date()),
        "holdoutUsed": False,
        "backtrader": {
            "fills": len(result.fills),
            "endingEquity": round(bt_end, 2),
            "fees": round(sum(f["comm"] for f in result.fills), 2),
            "sizing": "95 percent, fractional shares allowed",
            "costs": "5 bps commission, 1 bp slippage",
        },
        "lean": {
            "fills": len(lean),
            "endingEquity": 1239440.81,
            "fees": round(sum(f["fee"] for f in lean), 2),
            "sizing": "SetHoldings 95 percent, integer shares",
            "costs": "LEAN default equity fee, about $0.005 per share, no slippage model",
            "firstFill": lean[0] if lean else None,
        },
        "difference": round(1239440.81 - bt_end, 2),
        "causes": [
            "Fee model: LEAN charged a per-share fee; Backtrader charged 5 bps plus 1 bp slippage.",
            "Share rounding: LEAN used integer shares; Backtrader allowed fractions.",
            "Fill timing: LEAN market-on-open versus Backtrader next-bar open after the signal bar.",
            "Signal window: LEAN History(253) versus Backtrader close[-252]/close[-21].",
        ],
        "dividends": "Neither engine added cash dividends. Yahoo OHLC is split-adjusted and dividend-unadjusted. LEAN factor file is identity.",
        "buyAndHoldReturn": 14.5093,
        "promoted": False,
        "ranAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    OUT.write_text(json.dumps(report, indent=2))
    Path("/workspace/research/lab/momentum-v2-fills.json").write_text(json.dumps(result.fills, indent=2))
    print(json.dumps({"btFills": len(result.fills), "btEnd": round(bt_end, 2), "btFees": report["backtrader"]["fees"], "leanFills": len(lean), "leanFees": report["lean"]["fees"]}))


if __name__ == "__main__":
    main()
