"""Isolated Freqtrade 2026.10 backtest. Not imported by the TypeScript app.

Candles are a synthetic 5-minute series, not a market history. The process
has no exchange keys and dry_run stays true. GPL code stays in the venv.
"""
import json
import re
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pandas as pd

ROOT = Path("/workspace/.runtimes/freqtrade-run")
DATA = ROOT / "user_data" / "data"
BIN = Path("/workspace/.runtimes/freqtrade/bin/freqtrade")
STRATEGY = Path("/workspace/.runtimes/freqtrade/lib/python3.12/site-packages/freqtrade/templates")


def candles() -> None:
    DATA.mkdir(parents=True, exist_ok=True)
    start = datetime(2023, 12, 20, tzinfo=timezone.utc)
    rows = []
    price = 100.0
    for i in range(1200):
        # Drop, base, then recover so a 5m RSI can cross 30. Still synthetic.
        if 500 <= i < 560:
            drift = -0.35
        elif 560 <= i < 700:
            drift = 0.22
        else:
            drift = 0.01
        o = price
        c = max(1.0, price + drift)
        h = max(o, c) + 0.02
        l = min(o, c) - 0.02
        rows.append(
            {
                "date": start + timedelta(minutes=5 * i),
                "open": o,
                "high": h,
                "low": l,
                "close": c,
                "volume": 10.0,
            }
        )
        price = c
    frame = pd.DataFrame(rows)
    frame.to_feather(DATA / "BTC_USD-5m.feather")


def main() -> None:
    candles()
    config = {
        "dry_run": True,
        "timeframe": "5m",
        "stake_currency": "USD",
        "stake_amount": 100,
        "max_open_trades": 1,
        "dry_run_wallet": 1000,
        "trading_mode": "spot",
        "exchange": {"name": "kraken", "key": "", "secret": "", "pair_whitelist": ["BTC/USD"]},
        "pairlists": [{"method": "StaticPairList"}],
        "entry_pricing": {"price_side": "same", "use_order_book": False},
        "exit_pricing": {"price_side": "same", "use_order_book": False},
    }
    cfg = ROOT / "config.json"
    cfg.write_text(json.dumps(config))
    run = subprocess.run(
        [
            str(BIN),
            "backtesting",
            "--config",
            str(cfg),
            "--strategy",
            "SampleStrategy",
            "--strategy-path",
            str(STRATEGY),
            "--datadir",
            str(ROOT / "user_data" / "data"),
            "--timeframe",
            "5m",
            "--timerange",
            "20231221-20231224",
            "--userdir",
            str(ROOT / "user_data"),
            "--cache",
            "none",
            "--export",
            "none",
        ],
        capture_output=True,
        text=True,
        timeout=180,
        check=False,
    )
    text = run.stdout or ""
    trades = re.search(r"Total/Daily Avg Trades\s+│\s+(\d+)", text)
    profit = re.search(r"Absolute profit\s+│\s+(-?[0-9.]+) USD", text)
    final_balance = re.search(r"Final balance\s+│\s+(-?[0-9.]+) USD", text)
    out = ROOT / "backtest.log"
    out.write_text(text + "\n" + (run.stderr or ""))
    print(
        json.dumps(
            {
                "ok": run.returncode == 0,
                "code": run.returncode,
                "engine": "freqtrade",
                "version": "2026.10",
                "placeOrders": False,
                "dryRun": True,
                "dataset": "synthetic-5m-not-market-history",
                "tradeCount": int(trades.group(1)) if trades else None,
                "absoluteProfitUsd": float(profit.group(1)) if profit else None,
                "finalBalanceUsd": float(final_balance.group(1)) if final_balance else None,
                "log": str(out),
                "tail": (text or run.stderr)[-800:],
            }
        )
    )
    sys.exit(0 if run.returncode == 0 else 1)


if __name__ == "__main__":
    main()
