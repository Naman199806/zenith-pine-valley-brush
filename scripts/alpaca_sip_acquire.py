"""Operator-side read-only historical SIP acquisition.

Uses PAPER credentials from the environment. Never prints them.
Does not call order endpoints and does not forward-fill missing minutes.
"""

from __future__ import annotations

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

DATA = "https://data.alpaca.markets/v2"
PAPER = "https://paper-api.alpaca.markets/v2"
ET = ZoneInfo("America/New_York")
OUT = Path("research/data/raw/alpaca-sip")
SYMBOLS = ("SPY", "QQQ", "IWM")
SESSIONS = ("2024-11-01", "2024-11-04", "2024-11-29")


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
            raise
    raise RuntimeError("retry limit")


def calendar(day: str) -> dict:
    status, body = request(PAPER, "/calendar", {"start": day, "end": day})
    if status != 200 or not body:
        raise RuntimeError(f"calendar {day} status {status}")
    return body[0]


def bounds(day: str, session: dict) -> tuple[str, str]:
    open_et = datetime.fromisoformat(f"{day}T{session['open']}:00").replace(tzinfo=ET)
    close_et = datetime.fromisoformat(f"{day}T{session['close']}:00").replace(tzinfo=ET)
    last = close_et - timedelta(minutes=1)
    return open_et.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), last.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def bars(symbol: str, day: str, start: str, end: str) -> list[dict]:
    token = None
    rows = []
    while True:
        params = {"timeframe": "1Min", "start": start, "end": end, "feed": "sip", "limit": 10000}
        if token:
            params["page_token"] = token
        status, body = request(DATA, f"/stocks/{symbol}/bars", params)
        if status != 200:
            raise RuntimeError(f"bars {symbol} {day} status {status}")
        rows.extend(body.get("bars") or [])
        token = body.get("next_page_token")
        if not token:
            return rows


def atomic_write(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps(payload, indent=2))
    temp.replace(path)


def main() -> None:
    for symbol in SYMBOLS:
        for day in SESSIONS:
            path = OUT / symbol / f"{day}.json"
            if path.exists():
                print(json.dumps({"symbol": symbol, "day": day, "status": "resumed"}))
                continue
            session = calendar(day)
            start, end = bounds(day, session)
            rows = bars(symbol, day, start, end)
            digest = hashlib.sha256(json.dumps(rows, sort_keys=True).encode()).hexdigest()
            atomic_write(path, {"symbol": symbol, "day": day, "feed": "sip", "calendar": session, "bars": len(rows), "sha256": digest, "rows": rows})
            print(json.dumps({"symbol": symbol, "day": day, "bars": len(rows), "sha256": digest[:12]}))


if __name__ == "__main__":
    main()
