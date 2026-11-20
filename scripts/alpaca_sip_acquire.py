"""Operator-side read-only historical SIP acquisition.

Uses PAPER credentials from the environment. Never prints them.
Does not call order endpoints and does not forward-fill missing minutes.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from alpaca_sip_entitlement import sanitize, summarize

DATA = "https://data.alpaca.markets/v2"
PAPER = "https://paper-api.alpaca.markets/v2"
ET = ZoneInfo("America/New_York")
OUT = Path("research/data/raw/alpaca-sip")
DEFAULT_SYMBOLS = ("SPY", "QQQ", "IWM")
STAGE1 = ("2024-11-01", "2024-11-04", "2024-11-29")
PYTHON = r"C:\Users\sharm\openbb-research.venv\Scripts\python.exe"


def request(base: str, path: str, params: dict) -> tuple[int, dict | list]:
    key = os.environ["APCA_API_KEY_ID"]
    secret = os.environ["APCA_API_SECRET_KEY"]
    url = f"{base}{path}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return resp.status, json.loads(resp.read().decode())
        except urllib.error.HTTPError as exc:
            if exc.code == 429 and attempt < 3:
                time.sleep(2 ** attempt)
                continue
            raise RuntimeError(f"HTTP {exc.code}: {sanitize(exc.read().decode('utf-8', 'replace'))}") from None
    raise RuntimeError("retry limit")


def calendar(day: str) -> dict:
    status, body = request(PAPER, "/calendar", {"start": day, "end": day})
    if status != 200 or not body:
        raise RuntimeError(f"calendar {day} status {status}")
    return body[0]


def bounds(day: str, session: dict) -> tuple[datetime, datetime]:
    open_et = datetime.fromisoformat(f"{day}T{session['open']}:00").replace(tzinfo=ET)
    close_et = datetime.fromisoformat(f"{day}T{session['close']}:00").replace(tzinfo=ET)
    return open_et.astimezone(timezone.utc), (close_et - timedelta(minutes=1)).astimezone(timezone.utc)


def expected_from_calendar(start: datetime, end: datetime) -> set[str]:
    stamps = set()
    cursor = start.replace(second=0, microsecond=0)
    while cursor <= end:
        stamps.add(cursor.strftime("%Y-%m-%dT%H:%M:00Z"))
        cursor += timedelta(minutes=1)
    return stamps


def bars(symbol: str, start: str, end: str) -> list[dict]:
    token = None
    seen = set()
    rows = []
    for _ in range(20):
        params = {"timeframe": "1Min", "start": start, "end": end, "feed": "sip", "limit": 10000}
        if token:
            params["page_token"] = token
        status, body = request(DATA, f"/stocks/{symbol}/bars", params)
        if status != 200:
            raise RuntimeError(f"bars {symbol} status {status}")
        rows.extend(body.get("bars") or [])
        token = body.get("next_page_token")
        if not token:
            return rows
        if token in seen:
            raise RuntimeError("repeated pagination token")
        seen.add(token)
    raise RuntimeError("pagination limit reached")


def fingerprint(rows: list[dict]) -> str:
    return hashlib.sha256(json.dumps(rows, sort_keys=True).encode()).hexdigest()


def accept(path: Path, payload: dict, expected: set[str]) -> None:
    report = summarize(payload["rows"], expected)
    if report["missingMinutes"] or report["duplicates"] or report["malformedTimestamps"] or report["ohlcvFailures"] or report["outOfSessionBars"]:
        raise RuntimeError(f"session rejected {path}: {report}")
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps(payload, indent=2))
    temp.replace(path)


def sessions(start: str, end: str) -> list[str]:
    status, body = request(PAPER, "/calendar", {"start": start, "end": end})
    if status != 200 or not isinstance(body, list):
        raise RuntimeError(f"calendar range status {status}")
    return [row["date"] for row in body]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--symbols", default=",".join(DEFAULT_SYMBOLS))
    parser.add_argument("--start", default="2024-01-02")
    parser.add_argument("--end", default="")
    parser.add_argument("--stage1", action="store_true")
    args = parser.parse_args()
    symbols = tuple(item.strip() for item in args.symbols.split(",") if item.strip())
    end = args.end or datetime.now(ET).date().isoformat()
    days = list(STAGE1) if args.stage1 else sessions(args.start, end)
    for symbol in symbols:
        for day in days:
            path = OUT / symbol / f"{day}.json"
            session = calendar(day)
            start, close = bounds(day, session)
            expected = expected_from_calendar(start, close)
            if path.exists():
                existing = json.loads(path.read_text())
                if existing.get("sha256") != fingerprint(existing.get("rows") or []):
                    raise RuntimeError(f"fingerprint mismatch {path}")
                accept(path, existing, expected)
                print(json.dumps({"symbol": symbol, "day": day, "status": "revalidated"}))
                continue
            rows = bars(symbol, start.strftime("%Y-%m-%dT%H:%M:%SZ"), close.strftime("%Y-%m-%dT%H:%M:%SZ"))
            payload = {
                "symbol": symbol,
                "day": day,
                "feed": "sip",
                "calendar": session,
                "sha256": fingerprint(rows),
                "provenance": {"endpoint": DATA, "retrievedBy": PYTHON, "downloadedOnAsus": True, "fullArchive": False},
                "rows": rows,
            }
            accept(path, payload, expected)
            print(json.dumps({"symbol": symbol, "day": day, "bars": len(rows), "sha256": payload["sha256"]}))


if __name__ == "__main__":
    main()
