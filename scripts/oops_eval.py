"""Portable OOPS evaluation. Does not claim operator downloads."""

from __future__ import annotations

import hashlib
import json
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from oops_engine import normalize_rows, run_session

ET = ZoneInfo("America/New_York")

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "research/data/raw/alpaca-sip"
CALENDAR = ROOT / "research/lab/ir02-oops/exchange-calendar.json"
COSTS = (6, 12, 50)
CAPITAL = 100.0


def checksum(rows: list[dict]) -> str:
    return hashlib.sha256(json.dumps(rows, sort_keys=True).encode()).hexdigest()


def expected_stamps(day: str, calendar: dict) -> set[str]:
    open_ = datetime.fromisoformat(f"{day}T{calendar['open']}:00").replace(tzinfo=ET).astimezone(timezone.utc)
    close = datetime.fromisoformat(f"{day}T{calendar['close']}:00").replace(tzinfo=ET).astimezone(timezone.utc)
    stamps = set()
    cursor = open_.replace(second=0, microsecond=0)
    while cursor < close:
        stamps.add(cursor.strftime("%Y-%m-%dT%H:%M:00Z"))
        cursor += timedelta(minutes=1)
    return stamps


def load_calendar() -> list[dict]:
    if not CALENDAR.exists():
        raise FileNotFoundError("independent exchange calendar is missing")
    payload = json.loads(CALENDAR.read_text())
    if payload.get("source") != "alpaca-paper-calendar" or not payload.get("dates"):
        raise RuntimeError("exchange calendar is not independently persisted")
    return payload["dates"]


def load_verified(calendar: list[dict]) -> list[dict]:
    by_day = {row["date"]: row for row in calendar}
    files = []
    for path in sorted(RAW.glob("*/*.json")):
        payload = json.loads(path.read_text())
        rows = payload.get("rows") or []
        if payload.get("sha256") != checksum(rows):
            raise RuntimeError(f"checksum mismatch {path}")
        if payload.get("feed") != "sip" or path.parent.name != payload.get("symbol"):
            raise RuntimeError(f"feed or symbol mismatch {path}")
        session = by_day.get(payload.get("day"))
        if session is None:
            raise RuntimeError(f"session missing from exchange calendar {path}")
        bars = normalize_rows(rows)
        if {bar["t"] for bar in bars} != expected_stamps(payload["day"], session):
            raise RuntimeError(f"timestamp coverage failure {path}")
        if any(bar["open"] <= 0 or bar["high"] <= 0 or bar["low"] <= 0 or bar["close"] <= 0 for bar in bars):
            raise RuntimeError(f"price failure {path}")
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


def size_trade(trade: dict, cash: float) -> dict | None:
    unit = trade["entryPx"] * (1 + 6 / 10000)
    if unit <= 0 or cash < unit:
        return None
    scale = min(1.0, cash / (trade["entryPx"] + trade["costs"]))
    sized = dict(trade)
    sized["net"] = trade["net"] * scale
    sized["notional"] = trade["entryPx"] * scale
    sized["requiredCapital"] = trade["entryPx"] + trade["costs"]
    return sized


def metrics(trades: list[dict], sessions: list[str], benchmark: list[float]) -> dict:
    by_day = {}
    cash = CAPITAL
    busy_until = ""
    accepted = []
    for trade in sorted(trades, key=lambda item: item["entry"]):
        sized = size_trade(trade, cash)
        if sized is None or trade["entry"] < busy_until:
            continue
        cash += sized["net"]
        accepted.append(sized)
        by_day.setdefault(trade["day"], []).append(sized)
        busy_until = trade.get("exit", trade["entry"])
    equity = [CAPITAL]
    exposed_minutes = 0
    total_minutes = len(sessions) * 390
    for day in sessions:
        if day in by_day:
            for trade in by_day[day]:
                start = datetime.fromisoformat(trade["entry"].replace("Z", "+00:00"))
                end = datetime.fromisoformat(trade["exit"].replace("Z", "+00:00"))
                exposed_minutes += max(1, int((end - start).total_seconds() // 60))
            equity.append(equity[-1] + sum(trade["net"] for trade in by_day[day]))
        else:
            equity.append(equity[-1])
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
    return {
        "trades": len(accepted),
        "equityCurve": equity,
        "endingEquity": equity[-1],
        "maxDrawdown": drawdown,
        "sharpe": mean / math.sqrt(variance) if mean is not None and variance else None,
        "profitFactor": sum(wins) / abs(sum(losses)) if losses else None,
        "expectancy": sum(trade["net"] for trade in accepted) / len(accepted) if accepted else None,
        "exposure": exposed_minutes / total_minutes if total_minutes else 0,
        "benchmarkReturn": benchmark[-1] / benchmark[0] - 1 if len(benchmark) > 1 else None,
        "ledger": accepted,
    }


def evaluate() -> dict:
    try:
        calendar_rows = load_calendar()
    except (FileNotFoundError, RuntimeError) as exc:
        return {"status": "NOT_EVALUATED", "reason": str(exc), "fullArchive": False, "strategyApproved": False}
    files = load_verified(calendar_rows)
    if not files:
        return {"status": "NOT_EVALUATED", "reason": "no verified operator archive", "fullArchive": False, "strategyApproved": False}
    calendar = [row["date"] for row in calendar_rows]
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
        scenarios[str(cost)] = {"longOnly": metrics(long_only, calendar, benchmark), "longShort": metrics(trades, calendar, benchmark), "shortExecutionAssumed": False}
    return {"status": "EVALUATED", "costsBps": list(COSTS), "scenarios": scenarios, "qualified": False, "fullArchive": False, "strategyApproved": False}


def main() -> None:
    print(json.dumps(evaluate(), indent=2))


if __name__ == "__main__":
    main()
