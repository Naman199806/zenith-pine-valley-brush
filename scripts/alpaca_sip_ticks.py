"""Selective historical SIP trade and quote acquisition.

Operator evidence established endpoint access only. This does not download
the full tick archive or qualify an execution model.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import time
import urllib.error
import urllib.parse
import urllib.request
import re
from datetime import timezone
from pathlib import Path

from alpaca_sip_entitlement import sanitize

DATA = "https://data.alpaca.markets/v2"
OUT = Path("research/data/raw/alpaca-sip-ticks")
PYTHON = r"C:\Users\sharm\openbb-research.venv\Scripts\python.exe"
MAX_ROWS = 10000


def request(path: str, params: dict) -> dict:
    key = os.environ["APCA_API_KEY_ID"]
    secret = os.environ["APCA_API_SECRET_KEY"]
    url = f"{DATA}{path}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode())
        except urllib.error.HTTPError as exc:
            if exc.code == 429 and attempt < 3:
                time.sleep(2 ** attempt)
                continue
            raise RuntimeError(f"HTTP {exc.code}: {sanitize(exc.read().decode('utf-8', 'replace'))}") from None
    raise RuntimeError("retry limit")


STAMP = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$")


def timestamp(value: str) -> str | None:
    return value if isinstance(value, str) and STAMP.match(value) else None


def valid_quote(row: dict) -> bool:
    stamp = timestamp(str(row.get("t", "")))
    bid, ask = row.get("bp"), row.get("ap")
    sizes = (row.get("bs"), row.get("as"))
    return (
        stamp is not None
        and isinstance(bid, (int, float)) and isinstance(ask, (int, float))
        and math.isfinite(bid) and math.isfinite(ask)
        and 0 < bid <= ask
        and all(isinstance(size, int) and size >= 0 for size in sizes)
    )


def valid_trade(row: dict) -> bool:
    price, size = row.get("p"), row.get("s")
    return timestamp(str(row.get("t", ""))) is not None and isinstance(price, (int, float)) and math.isfinite(price) and price > 0 and isinstance(size, int) and size >= 0


def fetch(kind: str, symbol: str, start: str, end: str) -> list[dict]:
    token = None
    seen = set()
    rows = []
    for _ in range(20):
        params = {"start": start, "end": end, "feed": "sip", "limit": 1000}
        if token:
            params["page_token"] = token
        body = request(f"/stocks/{symbol}/{kind}", params)
        batch = body.get(kind) or []
        rows.extend(batch)
        if len(rows) > MAX_ROWS:
            raise RuntimeError("selective window exceeded row cap")
        token = body.get("next_page_token")
        if not token:
            return rows
        if token in seen:
            raise RuntimeError("repeated pagination token")
        seen.add(token)
    raise RuntimeError("pagination limit reached")


def accept(kind: str, rows: list[dict]) -> None:
    validator = valid_quote if kind == "quotes" else valid_trade
    if not all(validator(row) for row in rows):
        raise RuntimeError(f"invalid {kind} row")
    stamps = [timestamp(row["t"]) for row in rows]
    if stamps != sorted(stamps):
        raise RuntimeError(f"unordered {kind}")


def write(kind: str, symbol: str, start: str, rows: list[dict]) -> None:
    path = OUT / kind / symbol / f"{start[:10]}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "kind": kind,
        "symbol": symbol,
        "rows": len(rows),
        "sha256": hashlib.sha256(json.dumps(rows, sort_keys=True).encode()).hexdigest(),
        "fullArchive": False,
        "provenance": {"endpointAccessOnly": True, "retrievedBy": PYTHON},
        "data": rows,
    }
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps(payload, indent=2))
    temp.replace(path)


def causal_quote(quotes: list[dict], when: str) -> dict | None:
    eligible = [row for row in quotes if timestamp(row["t"]) and timestamp(row["t"]) <= when]
    return eligible[-1] if eligible else None


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--symbol", default="SPY")
    parser.add_argument("--start", required=True)
    parser.add_argument("--end", required=True)
    args = parser.parse_args()
    for kind in ("trades", "quotes"):
        rows = fetch(kind, args.symbol, args.start, args.end)
        accept(kind, rows)
        write(kind, args.symbol, args.start, rows)
        print(json.dumps({"kind": kind, "symbol": args.symbol, "rows": len(rows), "fullArchive": False}))


if __name__ == "__main__":
    main()
