"""Portable OOPS evaluation. Does not claim operator downloads."""

from __future__ import annotations

import hashlib
import json
import math
from datetime import datetime, timedelta
from pathlib import Path

from oops_engine import normalize_rows, run_session

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "research/data/raw/alpaca-sip"
COSTS = (6, 12, 50)
CAPITAL = 100.0


def checksum(rows: list[dict]) -> str:
    return hashlib.sha256(json.dumps(rows, sort_keys=True).encode()).hexdigest()


def expected_count(calendar: dict) -> int:
    open_ = datetime.fromisoformat(f"2000-01-01T{calendar['open']}:00")
    close = datetime.fromisoformat(f"2000-01-01T{calendar['close']}:00")
    return int((close - open_).total_seconds() // 60)


def load_verified() -> list[dict]:
    files = []
    for path in sorted(RAW.glob("*/*.json")):
        payload = json.loads(path.read_text())
        rows = payload.get("rows") or []
        if payload.get("sha256") != checksum(rows):
            raise RuntimeError(f"checksum mismatch {path}")
        if payload.get("feed") != "sip" or path.parent.name != payload.get("symbol"):
            raise RuntimeError(f"feed or symbol mismatch {path}")
        calendar = payload.get("calendar") or {}
        if calendar.get("date") != payload.get("day") or "open" not in calendar or "close" not in calendar:
            raise RuntimeError(f"calendar incomplete {path}")
        bars = normalize_rows(rows)
        if len(bars) != expected_count(calendar) or any(bar["open"] <= 0 or bar["high"] <= 0 or bar["low"] <= 0 or bar["close"] <= 0 for bar in bars):
            raise RuntimeError(f"coverage or price failure {path}")
        files.append({"symbol": payload["symbol"], "day": payload["day"], "bars": bars, "complete": True})
    return files


def preceding(files: list[dict], calendar: list[str], day: str) -> dict | None:
    if day not in calendar:
        return None
    index = calendar.index(day)
    if index == 0:
        return None
    previous = calendar[index - 1]
    match = next((item for item in files if item["day"] == previous), None)
    if match is None:
        return None
    return {"day": previous, "high": max(bar["high"] for bar in match["bars"]), "low": min(bar["low"] for bar in match["bars"])}


def metrics(trades: list[dict], benchmark: list[float]) -> dict:
    equity = [CAPITAL]
    cash = CAPITAL
    busy_until = ""
    accepted = []
    for trade in sorted(trades, key=lambda item: item["entry"]):
        if trade["entry"] < busy_until or trade["entryPx"] > cash:
            continue
        cash += trade["net"]
        equity.append(cash)
        accepted.append(trade)
        busy_until = trade.get("exit", trade["entry"])
    returns = [equity[i] / equity[i - 1] - 1 for i in range(1, len(equity))]
    peak = equity[0]
    drawdown = 0.0
    for value in equity:
        peak = max(peak, value)
        drawdown = min(drawdown, value / peak - 1)
    wins = [trade["net"] for trade in accepted if trade["net"] > 0]
    losses = [trade["net"] for trade in accepted if trade["net"] < 0]
    mean = sum(returns) / len(returns) if returns else None
    variance = sum((value - mean) ** 2 for value in returns) / len(returns) if returns and mean is not None else None
    sharpe = mean / math.sqrt(variance) if mean is not None and variance else None
    profit_factor = sum(wins) / abs(sum(losses)) if losses else None
    benchmark_return = benchmark[-1] / benchmark[0] - 1 if len(benchmark) > 1 else None
    return {
        "trades": len(accepted),
        "equityCurve": equity,
        "endingEquity": equity[-1],
        "maxDrawdown": drawdown,
        "sharpe": sharpe,
        "profitFactor": profit_factor,
        "expectancy": sum(trade["net"] for trade in accepted) / len(accepted) if accepted else None,
        "exposure": len(accepted) / max(len(trades), 1),
        "benchmarkReturn": benchmark_return,
        "ledger": accepted,
    }


def evaluate() -> dict:
    files = load_verified()
    if not files:
        return {"status": "NOT_EVALUATED", "reason": "no verified operator archive", "fullArchive": False, "strategyApproved": False}
    calendar = sorted({item["day"] for item in files})
    spy = [item for item in files if item["symbol"] == "SPY"]
    benchmark = [CAPITAL]
    for item in spy:
        benchmark.append(benchmark[-1] * item["bars"][-1]["close"] / item["bars"][0]["open"])
    scenarios = {}
    for cost in COSTS:
        trades = []
        for item in files:
            prior = preceding([row for row in files if row["symbol"] == item["symbol"]], calendar, item["day"])
            if prior is None:
                continue
            trade = run_session(prior, item["bars"], cost)
            if trade:
                trades.append({"symbol": item["symbol"], "day": item["day"], "priorSession": prior["day"], **trade})
        long_only = [trade for trade in trades if trade["side"] == "long"]
        scenarios[str(cost)] = {"longOnly": metrics(long_only, benchmark), "longShort": metrics(trades, benchmark), "shortExecutionAssumed": False}
    return {"status": "EVALUATED", "costsBps": list(COSTS), "scenarios": scenarios, "qualified": False, "fullArchive": False, "strategyApproved": False}


def main() -> None:
    print(json.dumps(evaluate(), indent=2))


if __name__ == "__main__":
    main()
