"""Operator-side read-only Alpaca historical entitlement check.

Reads PAPER credentials from the environment. Never prints them.
Does not call any order endpoint.

Alpaca's end parameter is inclusive. The request ends at 19:59:00Z so the
16:00 ET bar is not included.
"""

from __future__ import annotations

import json
import math
import os
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

BASE = "https://data.alpaca.markets/v2/stocks/SPY/bars"
START = datetime(2024, 11, 1, 13, 30, tzinfo=timezone.utc)
END = datetime(2024, 11, 1, 19, 59, tzinfo=timezone.utc)


def expected_minutes_between(start: datetime, end: datetime) -> set[str]:
    stamps = set()
    cursor = start
    while cursor <= end:
        stamps.add(cursor.strftime("%Y-%m-%dT%H:%M:00Z"))
        cursor += timedelta(minutes=1)
    return stamps


def expected_minutes() -> set[str]:
    return expected_minutes_between(START, END)


def normalize_timestamp(value: str) -> str | None:
    if not value or not value[value.rfind(":") + 1:value.rfind(":") + 2].isdigit():
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)
    except ValueError:
        return None
    return parsed.replace(second=0, microsecond=0).strftime("%Y-%m-%dT%H:%M:00Z")


def ohlcv_ok(bar: dict) -> bool:
    try:
        low, high = float(bar["l"]), float(bar["h"])
        open_, close, volume = float(bar["o"]), float(bar["c"]), float(bar["v"])
    except (KeyError, TypeError, ValueError):
        return False
    return all(math.isfinite(v) for v in (low, high, open_, close, volume)) and low <= open_ <= high and low <= close <= high and volume >= 0


def summarize(bars: list[dict], expected: set[str] | None = None) -> dict:
    expected = expected if expected is not None else expected_minutes()
    stamps = [normalize_timestamp(str(b.get("t", ""))) for b in bars]
    malformed = sum(stamp is None for stamp in stamps)
    counts: dict[str, int] = {}
    for stamp in stamps:
        if stamp:
            counts[stamp] = counts.get(stamp, 0) + 1
    observed = set(counts)
    return {
        "bars": len(bars),
        "expectedMinutes": len(expected),
        "missingMinutes": len(expected - observed),
        "missingSample": sorted(expected - observed)[:10],
        "duplicates": sum(count - 1 for count in counts.values() if count > 1),
        "outOfSessionBars": len(observed - expected),
        "malformedTimestamps": malformed,
        "ohlcvFailures": sum(not ohlcv_ok(bar) for bar in bars),
        "first": next((stamp for stamp in stamps if stamp), None),
        "last": next((stamp for stamp in reversed(stamps) if stamp), None),
        "includes1600Et": "2024-11-01T20:00:00Z" in observed,
    }


def sanitize(text: str) -> str:
    redacted = text.replace(os.environ.get("APCA_API_KEY_ID", "___"), "[redacted]")
    return redacted.replace(os.environ.get("APCA_API_SECRET_KEY", "___"), "[redacted]")[:300]


def fetch_pages(feed: str) -> dict:
    key = os.environ.get("APCA_API_KEY_ID", "")
    secret = os.environ.get("APCA_API_SECRET_KEY", "")
    if not key or not secret:
        return {"feed": feed, "status": "NO_CREDENTIALS"}
    bars: list[dict] = []
    token = None
    pages = 0
    status = None
    while True:
        params = {"timeframe": "1Min", "start": START.strftime("%Y-%m-%dT%H:%M:%SZ"), "end": END.strftime("%Y-%m-%dT%H:%M:%SZ"), "feed": feed, "limit": 10000}
        if token:
            params["page_token"] = token
        req = urllib.request.Request(f"{BASE}?{urllib.parse.urlencode(params)}", headers={"APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret})
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                status = resp.status
                body = json.loads(resp.read().decode())
        except urllib.error.HTTPError as exc:
            return {"feed": feed, "status": exc.code, "error": sanitize(exc.read().decode("utf-8", "replace"))}
        except Exception as exc:
            return {"feed": feed, "status": "ERROR", "error": sanitize(str(exc))}
        pages += 1
        bars.extend(body.get("bars") or [])
        token = body.get("next_page_token")
        if not token:
            break
        if pages > 20:
            return {"feed": feed, "status": status, "complete": False, "error": "pagination limit reached"}
    return {"feed": feed, "status": status, "complete": True, "pages": pages, **summarize(bars)}


def main() -> None:
    print(json.dumps({"sip": fetch_pages("sip"), "iex": fetch_pages("iex")}, indent=2))


if __name__ == "__main__":
    main()
