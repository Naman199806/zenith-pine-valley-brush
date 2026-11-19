"""Operator-side read-only Alpaca historical entitlement check.

Reads PAPER credentials from the environment. Never prints them.
Does not call any order endpoint.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

BASE = "https://data.alpaca.markets/v2/stocks/SPY/bars"
START = datetime(2024, 11, 1, 13, 30, tzinfo=timezone.utc)
END = datetime(2024, 11, 1, 20, 0, tzinfo=timezone.utc)


def expected_minutes() -> set[str]:
    stamps = set()
    cursor = START
    while cursor < END:
        stamps.add(cursor.strftime("%Y-%m-%dT%H:%M:00Z"))
        cursor += timedelta(minutes=1)
    return stamps


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
    expected = expected_minutes()
    stamps = [b.get("t", "")[:17] + "Z" if b.get("t") else "" for b in bars]
    observed = set(stamps)
    missing = sorted(expected - observed)
    outside = sorted(observed - expected)
    return {
        "feed": feed,
        "status": status,
        "complete": True,
        "pages": pages,
        "bars": len(bars),
        "expectedMinutes": len(expected),
        "missingMinutes": len(missing),
        "missingSample": missing[:10],
        "outOfSessionBars": len(outside),
        "first": stamps[0] if stamps else None,
        "last": stamps[-1] if stamps else None,
    }


def main() -> None:
    print(json.dumps({"sip": fetch_pages("sip"), "iex": fetch_pages("iex")}, indent=2))


if __name__ == "__main__":
    main()
