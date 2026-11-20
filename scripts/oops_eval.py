"""Portable OOPS evaluation. Does not claim operator downloads."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from oops_engine import normalize_rows, run_session

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "research/data/raw/alpaca-sip"
COSTS = (6, 12, 50)


def checksum(rows: list[dict]) -> str:
    return hashlib.sha256(json.dumps(rows, sort_keys=True).encode()).hexdigest()


def load_verified() -> list[dict]:
    files = []
    for path in sorted(RAW.glob("*/*.json")):
        payload = json.loads(path.read_text())
        rows = payload.get("rows") or []
        if payload.get("sha256") != checksum(rows):
            raise RuntimeError(f"checksum mismatch {path}")
        calendar = payload.get("calendar") or {}
        if calendar.get("date") != payload.get("day"):
            raise RuntimeError(f"calendar incomplete {path}")
        bars = normalize_rows(rows)
        files.append({"symbol": payload["symbol"], "day": payload["day"], "bars": bars, "complete": True})
    return files


def preceding(files: list[dict], day: str) -> dict | None:
    earlier = [item for item in files if item["day"] < day]
    if not earlier:
        return None
    last = max(earlier, key=lambda item: item["day"])
    return {"day": last["day"], "high": max(bar["high"] for bar in last["bars"]), "low": min(bar["low"] for bar in last["bars"])}


def metrics(trades: list[dict]) -> dict:
    equity = [100.0]
    for trade in trades:
        equity.append(equity[-1] + trade["net"])
    returns = [equity[i] / equity[i - 1] - 1 for i in range(1, len(equity))]
    peak = equity[0]
    drawdown = 0.0
    for value in equity:
        peak = max(peak, value)
        drawdown = min(drawdown, value / peak - 1)
    return {"trades": len(trades), "endingEquity": equity[-1], "maxDrawdown": drawdown, "meanReturn": sum(returns) / len(returns) if returns else None, "ledger": trades}


def evaluate() -> dict:
    files = load_verified()
    if not files:
        return {"status": "NOT_EVALUATED", "reason": "no verified operator archive", "strategyApproved": False}
    scenarios = {}
    for cost in COSTS:
        trades = []
        for item in files:
            prior = preceding([row for row in files if row["symbol"] == item["symbol"]], item["day"])
            if prior is None:
                continue
            trade = run_session(prior, item["bars"], cost)
            if trade:
                trades.append({"symbol": item["symbol"], "day": item["day"], "priorSession": prior["day"], **trade})
        long_only = [trade for trade in trades if trade["side"] == "long"]
        scenarios[str(cost)] = {"longOnly": metrics(long_only), "longShort": metrics(trades), "shortExecutionAssumed": False}
    return {"status": "EVALUATED", "costsBps": list(COSTS), "scenarios": scenarios, "qualified": False, "reason": "gates not satisfied by these results", "strategyApproved": False}


def main() -> None:
    print(json.dumps(evaluate(), indent=2))


if __name__ == "__main__":
    main()
