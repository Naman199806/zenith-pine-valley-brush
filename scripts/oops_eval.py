"""Portable OOPS evaluation. Does not claim operator downloads."""

from __future__ import annotations

import json
from pathlib import Path

from oops_engine import normalize_rows, prior_session, run_session

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "research/data/raw/alpaca-sip"


def load_verified() -> list[dict]:
    files = []
    for path in sorted(RAW.glob("*/*.json")):
        payload = json.loads(path.read_text())
        bars = normalize_rows(payload["rows"])
        files.append({"symbol": payload["symbol"], "day": payload["day"], "bars": bars, "complete": True})
    return files


def evaluate() -> dict:
    files = load_verified()
    if not files:
        return {"status": "NOT_EVALUATED", "reason": "no verified operator archive", "strategyApproved": False}
    trades = []
    for item in files:
        prior = prior_session([row for row in files if row["symbol"] == item["symbol"]], item["day"])
        if prior is None:
            continue
        trade = run_session(prior, item["bars"])
        if trade:
            trades.append({"symbol": item["symbol"], "day": item["day"], **trade})
    long_only = [trade for trade in trades if trade["side"] == "long"]
    return {
        "status": "EXPLORATORY",
        "longOnly": long_only,
        "longShort": trades,
        "shortExecutionAssumed": False,
        "gates": {"minTrades": 30, "severeBps": 50, "benchmark": "SPY"},
        "verdict": "NOT_QUALIFIED" if len(long_only) < 30 else "PENDING_BENCHMARK",
        "strategyApproved": False,
    }


def main() -> None:
    print(json.dumps(evaluate(), indent=2))


if __name__ == "__main__":
    main()
