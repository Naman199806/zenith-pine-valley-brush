"""Portable V1.2 report. Does not optimize parameters."""

import json
from pathlib import Path

from ir01_engine import run, segment, load

ROOT = Path(__file__).resolve().parents[1]
bounds = {"development": ("2010-01-04", "2017-12-29"), "validation": ("2018-01-02", "2022-12-30"), "previouslyInspected": ("2023-01-03", "2026-11-11")}
spy = load("SPY")
bh = {"equity": [{"date": b["date"], "openEquity": b["open"] / spy[0]["open"] * 100, "equity": b["close"] / spy[0]["open"] * 100, "unrealized": 0} for b in spy], "trades": []}
out = {"id": "ir01-sma18-v1.2", "strategyApproved": False, "verdict": "NO_WINNER", "walkForward": "NOT_EVALUATED", "regime": "NOT_EVALUATED", "symbols": {}}
for symbol in ("SPY", "QQQ", "IWM"):
    base = run(symbol, 0.0006)
    out["symbols"][symbol] = {"ledger": base["trades"]}
    for name, bound in bounds.items():
        out["symbols"][symbol][name] = {"strategy": segment(base, *bound), "spy": segment(bh, *bound)["totalReturn"]}
(ROOT / "research/lab/ir01-sma18/v1.2-results.json").write_text(json.dumps(out, indent=2))
print(out["verdict"])
