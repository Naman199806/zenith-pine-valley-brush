"""Freqtrade-environment crypto research on Coinbase public daily candles.

Native exchange trading stays disabled. This is not a profitability claim.
"""
import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen

OUT = Path("/workspace/research/lab/freqtrade-btc.json")


def fetch(symbol="BTC-USD", granularity=86400):
    url = f"https://api.exchange.coinbase.com/products/{symbol}/candles?granularity={granularity}"
    request = Request(url, headers={"User-Agent": "apex-quant-research"})
    with urlopen(request, timeout=20) as response:
        rows = json.loads(response.read().decode())
    # Coinbase returns [time, low, high, open, close, volume], newest first.
    bars = [
        {"ts": row[0], "low": row[1], "high": row[2], "open": row[3], "close": row[4], "volume": row[5]}
        for row in rows
        if all(isinstance(x, (int, float)) for x in row[:5])
    ]
    bars.sort(key=lambda item: item["ts"])
    return bars


def sma(values, period):
    out = [None] * len(values)
    window = 0.0
    for i, value in enumerate(values):
        window += value
        if i >= period:
            window -= values[i - period]
        if i >= period - 1:
            out[i] = window / period
    return out


def run(bars, fast=10, slow=30, fee=0.001):
    closes = [bar["close"] for bar in bars]
    fast_sma = sma(closes, fast)
    slow_sma = sma(closes, slow)
    cash = 10_000.0
    units = 0.0
    entry = None
    trades = []
    for i in range(1, len(bars)):
        if fast_sma[i] is None or slow_sma[i] is None or fast_sma[i - 1] is None or slow_sma[i - 1] is None:
            continue
        crossed_up = fast_sma[i - 1] <= slow_sma[i - 1] and fast_sma[i] > slow_sma[i]
        crossed_down = fast_sma[i - 1] >= slow_sma[i - 1] and fast_sma[i] < slow_sma[i]
        price = bars[i]["close"]
        if units == 0 and crossed_up:
            spend = cash * (1 - fee)
            units = spend / price
            cash = 0.0
            entry = price
        elif units > 0 and crossed_down:
            proceeds = units * price * (1 - fee)
            pnl = proceeds - (entry * units if entry else 0)
            trades.append({"pnl": round(pnl, 2)})
            cash = proceeds
            units = 0.0
            entry = None
    end = cash + units * closes[-1]
    wins = [t["pnl"] for t in trades if t["pnl"] > 0]
    losses = [t["pnl"] for t in trades if t["pnl"] <= 0]
    net = sum(t["pnl"] for t in trades)
    return {
        "tradeCount": len(trades),
        "winRate": round(len(wins) / len(trades), 4) if trades else None,
        "netPnl": round(net, 2),
        "profitFactor": round(sum(wins) / abs(sum(losses)), 3) if losses and sum(losses) else None,
        "startValue": 10_000,
        "endValue": round(end, 2),
        "netReturn": round((end - 10_000) / 10_000, 4),
    }


def main():
    bars = fetch()
    report = {
        "schemaVersion": "apex.lab.v1",
        "engine": "freqtrade-env",
        "version": "2026.10",
        "strategy": "sma-10-30",
        "symbol": "BTC-USD",
        "venue": "coinbase",
        "dataSource": "Coinbase Exchange public candles",
        "coverage": {"bars": len(bars), "first": bars[0]["ts"], "last": bars[-1]["ts"]},
        "synthetic": False,
        "validated": False,
        "paperAutoEligible": False,
        "placeOrders": False,
        "metrics": run(bars),
        "note": "Public daily candles only. 10 bps fee each side. Native exchange trading is disabled. Not a profitability claim. GPL distribution remains blocked.",
        "ranAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(report, indent=2))
    print(json.dumps({"ok": True, "trades": report["metrics"]["tradeCount"], "netPnl": report["metrics"]["netPnl"]}))


if __name__ == "__main__":
    main()
