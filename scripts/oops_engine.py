"""Deterministic OOPS reversal on chronological SIP minute bars.

Same-minute stop and entry is treated as a stop. No profitable ordering is assumed.
"""

from __future__ import annotations


def run_session(prior: dict, minutes: list[dict], cost: float = 0.0006) -> dict | None:
    if not minutes:
        return None
    first = minutes[0]
    side = None
    trigger = None
    if first["open"] < prior["low"]:
        side, trigger = "long", prior["low"]
    elif first["open"] > prior["high"]:
        side, trigger = "short", prior["high"]
    if side is None:
        return None
    for bar in minutes[1:]:
        crossed = bar["high"] >= trigger if side == "long" else bar["low"] <= trigger
        if not crossed:
            continue
        fill = max(trigger, bar["open"]) if side == "long" else min(trigger, bar["open"])
        prior_extreme = min(b["low"] for b in minutes[:minutes.index(bar)]) if side == "long" else max(b["high"] for b in minutes[:minutes.index(bar)])
        stop = prior_extreme
        stopped_same_minute = bar["low"] <= stop if side == "long" else bar["high"] >= stop
        exit_px = stop if stopped_same_minute else None
        exit_time = bar["t"]
        if exit_px is None:
            for later in minutes[minutes.index(bar) + 1:]:
                hit = later["low"] <= stop if side == "long" else later["high"] >= stop
                if hit:
                    exit_px, exit_time = stop, later["t"]
                    break
            else:
                exit_px, exit_time = minutes[-1]["close"], minutes[-1]["t"]
        gross = (exit_px - fill) / fill if side == "long" else (fill - exit_px) / fill
        return {
            "side": side,
            "entry": bar["t"],
            "entryPx": fill,
            "stop": stop,
            "exit": exit_time,
            "exitPx": exit_px,
            "sameMinuteStop": stopped_same_minute,
            "netReturn": gross - 2 * cost,
        }
    return None
