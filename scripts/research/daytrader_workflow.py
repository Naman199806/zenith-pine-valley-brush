"""Offline day-trader skill workflow. Does not call trader-broker.

Scanner, entry, exit, risk, alerts, and a seeded Time Machine replay.
Outputs are hypotheses. Opening-range hits and Time Machine rates are not
probabilities and are not evidence of profitability.
"""
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path("/workspace/.runtimes/day-trader-skill")
FIX = ROOT / "tests" / "fixtures"
WORK = Path("/workspace/.runtimes/day-trader-run")
PY = sys.executable


def run(cmd, cwd):
    proc = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=60, check=False)
    return {
        "cmd": [str(part) for part in cmd if "broker" not in str(part)],
        "code": proc.returncode,
        "stdout": (proc.stdout or "")[-1500:],
        "stderr": (proc.stderr or "")[-500:],
    }


def main():
    WORK.mkdir(parents=True, exist_ok=True)
    if any("trader-broker" in part for part in sys.argv):
        raise SystemExit("broker tool is blocked")
    daily_out = WORK / "daily.json"
    orb_out = WORK / "orb.json"
    plan_out = WORK / "plan.json"
    risk_out = WORK / "risk.json"
    alerts_out = WORK / "alerts.json"
    tm_out = WORK / "timemachine.json"
    steps = []
    steps.append(
        run(
            [
                PY,
                str(ROOT / "trader-scanner" / "scan.py"),
                "daily",
                "--symbols",
                "KO,TSLA",
                "--offline",
                str(FIX / "trader-scanner" / "daily-spark-2026-10-19.json"),
                "--now",
                "2026-10-19 09:00",
                "--min-price",
                "0",
                "--min-volume",
                "0",
                "--json",
                "--no-write",
            ],
            ROOT / "trader-scanner",
        )
    )
    steps.append(
        run(
            [
                PY,
                str(ROOT / "trader-scanner" / "scan.py"),
                "orb",
                "--symbols",
                "TSLA",
                "--offline",
                str(FIX / "trader-scanner" / "wall5m-2026-10-19.json.gz"),
                "--now",
                "2026-10-19 10:15",
                "--min-price",
                "0",
                "--json",
                "--no-write",
            ],
            ROOT / "trader-scanner",
        )
    )
    steps.append(
        run(
            [
                PY,
                str(ROOT / "trader-entry" / "entry.py"),
                "check",
                "TSLA",
                "--now",
                "2026-10-19 10:15",
                "--offline",
                str(FIX / "trader-entry" / "TSLA-2026-10-19-5m.json"),
                "--json",
            ],
            ROOT / "trader-entry",
        )
    )
    steps.append(
        run(
            [
                PY,
                str(ROOT / "trader-exit" / "exit.py"),
                "plan",
                "--symbol",
                "TSLA",
                "--entry",
                "364.18",
                "--or-high",
                "362.18",
                "--or-low",
                "354.47",
                "--json",
                "--write",
                str(plan_out),
            ],
            ROOT / "trader-exit",
        )
    )
    prices = WORK / "prices.json"
    prices.write_text(
        json.dumps(
            {
                "as_of": "2026-10-19T14:20:00Z",
                "prices": {"TSLA": 366.475},
                "detail": {"TSLA": {"time": "2026-10-19T14:18:00Z", "fetched": "2026-10-19T14:20:00Z"}},
            }
        )
    )
    steps.append(
        run(
            [
                PY,
                str(ROOT / "trader-risk" / "check.py"),
                "--orders",
                str(FIX / "trader-risk" / "orders-tsla.json"),
                "--config",
                str(ROOT / "trader-budget" / "config.example.json"),
                "--portfolio",
                str(WORK / "missing-portfolio.json"),
                "--prices",
                str(prices),
                "--state",
                str(WORK / "missing-broker.json"),
                "--now",
                "2026-10-19 10:20",
                "--json",
                "--no-write",
            ],
            ROOT / "trader-risk",
        )
    )
    steps.append(
        run(
            [
                PY,
                str(ROOT / "trader-alerts" / "alerts.py"),
                "clock",
                "--now",
                "2026-10-19 10:15",
                "--json",
            ],
            ROOT / "trader-alerts",
        )
    )
    steps.append(
        run(
            [
                PY,
                str(ROOT / "trader-timemachine" / "timemachine.py"),
                "run",
                "--symbol",
                "TSLA",
                "--date",
                "2026-10-19",
                "--entry",
                "364.18",
                "--stop",
                "358.32",
                "--target",
                "370.04",
                "--entry-time",
                "10:15 AM",
                "--replays",
                "200",
                "--seed",
                "19",
                "--offline",
                str(FIX / "trader-timemachine" / "TSLA-60d5m.json.gz"),
                "--json",
                "--write",
                str(tm_out),
            ],
            ROOT / "trader-timemachine",
        )
    )
    broker = ROOT / "trader-broker" / "ticket.py"
    called_broker = any(str(broker) in step["cmd"] or "ticket.py" in " ".join(step["cmd"]) for step in steps)
    risk_ok = steps[4]["code"] in (0, 1) and "verdict" in steps[4]["stdout"]
    others_ok = all(step["code"] == 0 for i, step in enumerate(steps) if i != 4)
    payload = {
        "ok": others_ok and risk_ok and not called_broker,
        "engine": "day-trader-skill",
        "commit": "3d0f4ef6986f4984b7c6bd46f7ff4f87744c3abd",
        "brokerInvoked": called_broker,
        "placeOrders": False,
        "executable": False,
        "uncalibrated": True,
        "note": "Scanner and Time Machine output is not a probability and not a profitability claim.",
        "steps": [
            {"code": step["code"], "tail": step["stdout"].splitlines()[-1] if step["stdout"] else step["stderr"][:240]}
            for step in steps
        ],
        "raw": [step["stdout"][:800] for step in steps],
        "ranAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    daily_out.write_text(steps[0]["stdout"])
    orb_out.write_text(steps[1]["stdout"])
    risk_out.write_text(steps[4]["stdout"])
    alerts_out.write_text(steps[5]["stdout"])
    out = WORK / "workflow.json"
    out.write_text(json.dumps(payload))
    print(json.dumps({"ok": payload["ok"], "steps": payload["steps"], "brokerInvoked": called_broker, "log": str(out)}))
    raise SystemExit(0 if payload["ok"] else 1)


if __name__ == "__main__":
    main()
