"""Deterministic OOPS reversal on chronological SIP minute bars."""

from __future__ import annotations

from alpaca_sip_entitlement import normalize_timestamp, ohlcv_ok


def normalize_rows(rows: list[dict]) -> list[dict]:
    bars = []
    for row in rows:
        stamp = normalize_timestamp(str(row.get("t", "")))
        if stamp is None or not ohlcv_ok(row):
            raise ValueError("invalid Alpaca bar")
        bars.append({"t": stamp, "open": float(row["o"]), "high": float(row["h"]), "low": float(row["l"]), "close": float(row["c"]), "volume": float(row["v"])})
    if bars != sorted(bars, key=lambda bar: bar["t"]):
        raise ValueError("bars are not chronological")
    return bars


def resolve_same_minute(side: str, open_px: float, stop: float, evidence: dict | None = None) -> tuple[float, str]:
    fill = min(open_px, stop) if side == "long" else max(open_px, stop)
    return fill, "conservative"


def prior_session(files: list[dict], day: str) -> dict | None:
    earlier = [item for item in files if item["day"] < day and item.get("complete")]
    if not earlier:
        return None
    last = max(earlier, key=lambda item: item["day"])
    return {"high": max(bar["high"] for bar in last["bars"]), "low": min(bar["low"] for bar in last["bars"])}


def run_session(prior: dict, minutes: list[dict], cost_bps: float = 6.0, notional: float = 100.0) -> dict | None:
    if len(minutes) < 2 or minutes != sorted(minutes, key=lambda bar: bar["t"]):
        raise ValueError("incomplete or unordered session")
    first = minutes[0]
    side = trigger = None
    if first["open"] < prior["low"]:
        side, trigger = "long", prior["low"]
    elif first["open"] > prior["high"]:
        side, trigger = "short", prior["high"]
    if side is None:
        return None
    for index, bar in enumerate(minutes[1:], start=1):
        crossed = bar["high"] >= trigger if side == "long" else bar["low"] <= trigger
        if not crossed:
            continue
        fill = max(trigger, bar["open"]) if side == "long" else min(trigger, bar["open"])
        stop = min(item["low"] for item in minutes[:index]) if side == "long" else max(item["high"] for item in minutes[:index])
        same = bar["low"] <= stop if side == "long" else bar["high"] >= stop
        if same:
            exit_px, method = resolve_same_minute(side, bar["open"], stop, bar.get("evidence"))
            exit_time = bar["t"]
        else:
            exit_px = exit_time = None
            for later in minutes[index + 1:]:
                hit = later["low"] <= stop if side == "long" else later["high"] >= stop
                if hit:
                    exit_px = min(later["open"], stop) if side == "long" else max(later["open"], stop)
                    exit_time = later["t"]
                    break
            if exit_px is None:
                exit_px, exit_time = minutes[-1]["close"], minutes[-1]["t"]
        qty = notional / fill
        entry_cost = qty * fill * cost_bps / 10000
        exit_cost = qty * exit_px * cost_bps / 10000
        gross = qty * (exit_px - fill) if side == "long" else qty * (fill - exit_px)
        return {"side": side, "entry": bar["t"], "entryPx": fill, "stop": stop, "exit": exit_time, "exitPx": exit_px, "sameMinuteStop": same, "resolution": method if same else "later-bar", "gross": gross, "costs": entry_cost + exit_cost, "net": gross - entry_cost - exit_cost}
    return None
