"""Portable V1.2 report. Generates the committed results artifact. Does not optimize."""

import json
from pathlib import Path

from ir01_engine import load, run, segment

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "research/lab/ir01-sma18/v1.2-results.json"
BOUNDS = {
    "development": ("2010-01-04", "2017-12-29"),
    "validation": ("2018-01-02", "2022-12-30"),
    "previouslyInspected": ("2023-01-03", "2026-11-11"),
}
spy = load("SPY")
bh = {"equity": [{"date": b["date"], "openEquity": b["open"] / spy[0]["open"] * 100, "equity": b["close"] / spy[0]["open"] * 100, "unrealized": 0} for b in spy], "trades": []}
out = {
    "id": "ir01-sma18-v1.2",
    "strategyApproved": False,
    "verdict": "NO_WINNER",
    "walkForward": "NOT_EVALUATED",
    "regime": "NOT_EVALUATED",
    "qualification": {"minTrades": 30, "severeBpsPerSide": 50, "operative": True, "met": False},
    "accountingLimitations": [
        "Opening equity is the first in-period bar's open mark, not the prior close.",
        "Realized P&L includes the full trade even when the entry was before the segment.",
        "Unrealized is marked against original entry cash, not the segment-start mark.",
        "Fees include only trades completed inside the segment.",
        "SPY benchmark is a price-ratio buy-and-hold, not the strategy cost model.",
    ],
    "symbols": {},
}
for symbol in ("SPY", "QQQ", "IWM"):
    base, two, severe = run(symbol, 0.0006), run(symbol, 0.0012), run(symbol, 0.005)
    out["symbols"][symbol] = {"ledger": base["trades"]}
    for name, bound in BOUNDS.items():
        out["symbols"][symbol][name] = {
            "strategy": segment(base, *bound),
            "twoX": segment(two, *bound)["totalReturn"],
            "severe50bps": segment(severe, *bound)["totalReturn"],
            "spy": segment(bh, *bound)["totalReturn"],
        }
OUT.write_text(json.dumps(out, indent=2))
print(out["verdict"])
