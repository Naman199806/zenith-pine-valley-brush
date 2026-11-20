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
from datetime import datetime, timezone
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


def epoch_ns(value: str) -> int | None:
    if not isinstance(value, str) or not STAMP.match(value):
        return None
    whole, _, fraction = value[:-1].partition(".")
    try:
        seconds = int(datetime.fromisoformat(whole).replace(tzinfo=timezone.utc).timestamp())
    except ValueError:
        return None
    return seconds * 1_000_000_000 + int(fraction.ljust(9, "0")[:9] or "0")


def timestamp(value: str) -> str | None:
    return value if epoch_ns(value) is not None else None


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


def eligible(row: dict, kind: str) -> bool:
    conditions = row.get("c") or []
    size = row.get("s") if kind == "trades" else min(row.get("bs", 0), row.get("as", 0))
    return isinstance(conditions, list) and isinstance(size, int) and size > 0 and not any(code in ("Z", "U") for code in conditions)


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


def valid_trade(row: dict) -> bool:
    price, size = row.get("p"), row.get("s")
    return timestamp(str(row.get("t", ""))) is not None and isinstance(price, (int, float)) and math.isfinite(price) and price > 0 and isinstance(size, int) and size > 0


def causal_quote(quotes: list[dict], when: str, window_start: str, window_end: str, max_age_ns: int = 5_000_000_000) -> dict | None:
    event = epoch_ns(when)
    start = epoch_ns(window_start)
    end = epoch_ns(window_end)
    if event is None or start is None or end is None or not quotes:
        return None
    eligible_rows = []
    for index, row in enumerate(quotes):
        stamp = epoch_ns(str(row.get("t", "")))
        if stamp is None or stamp < start or stamp > end or stamp > event or event - stamp > max_age_ns or not valid_quote(row) or not eligible(row, "quotes"):
            continue
        eligible_rows.append((stamp, index, row))
    return max(eligible_rows)[2] if eligible_rows else None


def accept(kind: str, rows: list[dict], window_start: str, window_end: str) -> None:
    if not rows:
        raise RuntimeError(f"empty {kind} archive")
    validator = valid_quote if kind == "quotes" else valid_trade
    if not all(validator(row) for row in rows):
        raise RuntimeError(f"invalid {kind} row")
    start, end = epoch_ns(window_start), epoch_ns(window_end)
    stamps = [epoch_ns(row["t"]) for row in rows]
    if any(stamp is None or start is None or end is None or stamp < start or stamp > end for stamp in stamps) or stamps != sorted(stamps):
        raise RuntimeError(f"unordered or out-of-window {kind}")


def write(kind: str, symbol: str, start: str, end: str, rows: list[dict]) -> None:
    name = f"{start}_{end}".replace(":", "").replace("-", "")
    path = OUT / kind / symbol / f"{name}.json"
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


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--symbol", default="SPY")
    parser.add_argument("--start", required=True)
    parser.add_argument("--end", required=True)
    args = parser.parse_args()
    for kind in ("trades", "quotes"):
        rows = fetch(kind, args.symbol, args.start, args.end)
        accept(kind, rows, args.start, args.end)
        write(kind, args.symbol, args.start, args.end, rows)
        print(json.dumps({"kind": kind, "symbol": args.symbol, "rows": len(rows), "fullArchive": False}))


if __name__ == "__main__":
    main()
