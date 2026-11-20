"""Read-only CFTC COT parser. Release-aware. Does not write broker orders."""

from __future__ import annotations

import csv
import io
import zipfile
from datetime import datetime, timedelta
from pathlib import Path

MARKET = "E-MINI S&P 500 - CHICAGO MERCANTILE EXCHANGE"


def parse_zip(path: Path) -> list[dict]:
    with zipfile.ZipFile(path) as zf:
        name = zf.namelist()[0]
        text = zf.read(name).decode("latin-1")
    rows = []
    for row in csv.DictReader(io.StringIO(text)):
        if row["Market and Exchange Names"] != MARKET:
            continue
        asof = row["As of Date in Form YYYY-MM-DD"]
        long_ = int(row["Commercial Positions-Long (All)"].replace(",", "").strip() or 0)
        short = int(row["Commercial Positions-Short (All)"].replace(",", "").strip() or 0)
        usable = (datetime.fromisoformat(asof) + timedelta(days=6)).date().isoformat()
        rows.append({"asof": asof, "usableFrom": usable, "commercialNet": long_ - short, "openInterest": int(row["Open Interest (All)"].replace(",", "").strip() or 0)})
    return rows


def trailing_signal(rows: list[dict]) -> list[dict]:
    ordered = sorted(rows, key=lambda r: r["asof"])
    out = []
    for i, row in enumerate(ordered):
        window = [r["commercialNet"] for r in ordered[max(0, i - 51):i + 1]]
        if len(window) < 52:
            continue
        ordered_window = sorted(window)
        mid = len(ordered_window) // 2
        median = (ordered_window[mid - 1] + ordered_window[mid]) / 2 if len(window) % 2 == 0 else ordered_window[mid]
        out.append({**row, "median": median, "aboveMedian": row["commercialNet"] > median})
    return out
