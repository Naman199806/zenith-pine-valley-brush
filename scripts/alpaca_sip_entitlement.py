"""Operator-side read-only Alpaca historical entitlement check.

Reads PAPER credentials from the environment. Never prints them.
Does not call any order endpoint.
"""

from __future__ import annotations

import json
import os
import urllib.parse
import urllib.request
from collections import Counter

BASE = "https://data.alpaca.markets/v2/stocks/SPY/bars"
START = "2024-11-01T14:30:00Z"
END = "2024-11-01T21:00:00Z"


def fetch(feed: str) -> dict:
    key = os.environ.get("APCA_API_KEY_ID", "")
    secret = os.environ.get("APCA_API_SECRET_KEY", "")
    if not key or not secret:
        return {"feed": feed, "status": "NO_CREDENTIALS"}
    query = urllib.parse.urlencode({"timeframe": "1Min", "start": START, "end": END, "feed": feed, "limit": 10000})
    req = urllib.request.Request(f"{BASE}?{query}", headers={"APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = json.loads(resp.read().decode())
            status = resp.status
    except Exception as exc:
        return {"feed": feed, "status": "ERROR", "error": type(exc).__name__}
    bars = body.get("bars") or []
    stamps = [b.get("t") for b in bars]
    dupes = sum(v - 1 for v in Counter(stamps).values() if v > 1)
    bad = [b for b in bars if not (b.get("l", 0) <= b.get("o", 0) <= b.get("h", 0) and b.get("l", 0) <= b.get("c", 0) <= b.get("h", 0) and b.get("v", 0) >= 0)]
    return {
        "feed": feed,
        "status": status,
        "bars": len(bars),
        "first": stamps[0] if stamps else None,
        "last": stamps[-1] if stamps else None,
        "duplicates": dupes,
        "ohlcvFailures": len(bad),
        "nextPage": bool(body.get("next_page_token")),
    }


def main() -> None:
    print(json.dumps({"sip": fetch("sip"), "iex": fetch("iex")}, indent=2))


if __name__ == "__main__":
    main()
