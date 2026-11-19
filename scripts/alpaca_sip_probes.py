"""Read-only entitlement probes for historical SIP trades and quotes.

Minute-bar access does not prove these endpoints. Never prints credentials.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request

BASE = "https://data.alpaca.markets/v2/stocks/SPY"
START = "2024-11-01T13:30:00Z"
END = "2024-11-01T13:31:00Z"


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
            return {"endpoint": kind, "status": resp.status, "rows": len(rows), "spreadSupported": kind == "quotes" and bool(rows)}
    except urllib.error.HTTPError as exc:
        return {"endpoint": kind, "status": exc.code, "error": exc.read().decode("utf-8", "replace")[:200]}


def main() -> None:
    print(json.dumps({"trades": probe("trades"), "quotes": probe("quotes")}, indent=2))


if __name__ == "__main__":
    main()
