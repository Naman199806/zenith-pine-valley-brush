"""Hermes evaluation of completed Backtrader and Freqtrade research.

Cannot change execution settings. Cannot approve itself.
"""
import json
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path

HOME = Path("/workspace/.runtimes/hermes-home")
BIN = Path("/workspace/.runtimes/hermes314/bin/hermes")
OUT = Path("/workspace/research/lab/hermes-eval.json")
BT = json.loads(Path("/workspace/research/lab/backtrader-spy.json").read_text())
FT = json.loads(Path("/workspace/research/lab/freqtrade-btc.json").read_text())


def main():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    env = {k: v for k, v in os.environ.items() if not k.startswith("APCA_") and "PAPER" not in k}
    env["HOME"] = str(HOME)
    env["HERMES_HOME"] = str(HOME)
    prompt = (
        "You are reviewing completed research. Do not place orders. Do not change risk limits. "
        "Do not declare success. Reply with one JSON object only, keys: diagnosis, overfitRisks, hypotheses, selfDeclaredSuccess. "
        "selfDeclaredSuccess must be false. hypotheses must be an array of exactly 3 objects with keys id, change, holdout. "
        f"SPY SMA 20/50 closed-trade PnL {BT['metrics']['closedTradePnl']} on 100000, equity change {BT['metrics']['equityChange']}, "
        f"buy-and-hold return {BT['metrics']['buyAndHoldReturn']}, sample ends {BT['coverage']['last']} because last 252 sessions are holdout. "
        f"BTC SMA 10/30 on {FT['coverage']['bars']} Coinbase daily bars: net {FT['metrics']['netPnl']}, return {FT['metrics']['netReturn']}, 6 trades. "
        "Diagnosis must explain the weak relative performance. Do not invent a profit."
    )
    proc = subprocess.run(
        [str(BIN), "--oneshot", prompt, "--provider", "xai", "--model", "grok-4.20-0309-non-reasoning"],
        cwd=str(HOME),
        env=env,
        capture_output=True,
        text=True,
        timeout=180,
        check=False,
    )
    text = proc.stdout or ""
    start, end = text.find("{"), text.rfind("}")
    parsed = None
    if start >= 0 and end > start:
        try:
            parsed = json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            parsed = None
    ok = proc.returncode == 0 and isinstance(parsed, dict) and parsed.get("selfDeclaredSuccess") is False and len(parsed.get("hypotheses") or []) == 3
    payload = {
        "ok": ok,
        "engine": "hermes",
        "selfDeclaredSuccess": False if parsed is None else parsed.get("selfDeclaredSuccess"),
        "diagnosis": None if parsed is None else parsed.get("diagnosis"),
        "overfitRisks": None if parsed is None else parsed.get("overfitRisks"),
        "hypotheses": None if parsed is None else parsed.get("hypotheses"),
        "placeOrders": False,
        "canApprove": False,
        "code": proc.returncode,
        "ranAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    OUT.write_text(json.dumps(payload, indent=2))
    print(json.dumps({"ok": ok, "code": proc.returncode, "hypotheses": len(payload["hypotheses"] or [])}))


if __name__ == "__main__":
    main()
