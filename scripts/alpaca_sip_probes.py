"""Read-only entitlement probes for historical SIP trades and quotes."""

from __future__ import annotations

import json
import math
import os
import urllib.error
import urllib.parse
import urllib.request

from alpaca_sip_entitlement import normalize_timestamp, sanitize

BASE = "https://data.alpaca.markets/v2/stocks/SPY"
START = "2024-11-01T13:30:00Z"
END = "2024-11-01T13:31:00Z"


def quote_ready(rows: list[dict]) -> bool:
    stamps = []
    for row in rows:
        stamp = normalize_timestamp(str(row.get("t", "")))
        bid, ask = row.get("bp"), row.get("ap")
        if stamp is None or not isinstance(bid, (int, float)) or not isinstance(ask, (int, float)):
            return False
        if not math.isfinite(bid) or not math.isfinite(ask) or ask < bid or bid <= 0:
            return False
        stamps.append(stamp)
    return stamps == sorted(stamps)


def probe(kind: str) -> dict:
    key = os.environ.get("APCA_API_KEY_ID", "")
    secret = os.environ.get("APCA_API_SECRET_KEY", "")
    if not key or not secret:
        return {"endpoint": kind, "status": "NO_CREDENTIALS"}
    params = urllib.parse.urlencode({"start": START, "end": END, "feed": "sip", "limit": 10})
    req = urllib.request.Request(f"{BASE}/{kind}?{params}", headers={"APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = json.loads(resp.read().decode())
            rows = body.get(kind) or []
            return {"endpoint": kind, "status": resp.status, "rows": len(rows), "endpointAccess": bool(rows), "spreadSimulationSupported": kind == "quotes" and quote_ready(rows)}
    except urllib.error.HTTPError as exc:
        return {"endpoint": kind, "status": exc.code, "error": sanitize(exc.read().decode("utf-8", "replace"))}


def main() -> None:
    print(json.dumps({"trades": probe("trades"), "quotes": probe("quotes")}, indent=2))


if __name__ == "__main__":
    main()
