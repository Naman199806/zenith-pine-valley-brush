"""Restricted Hermes one-shot. Research memory only.

The process home is a scratch directory. Alpaca credentials are removed from
the environment. It may not declare its own success. A missing install or a
provider error is written as a blocker, not a passing review.
"""
import json
import os
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path

HOME = Path("/workspace/.runtimes/hermes-home")
BIN = Path("/workspace/.runtimes/hermes314/bin/hermes")
PY = Path("/workspace/.runtimes/hermes314/bin/python")
SKILLS = Path("/workspace/integrations/hermes/skills")
OUT = Path("/workspace/.runtimes/hermes-run")
JOURNAL = {
    "mode": "MONITORING",
    "note": "Synthetic journal. No Alpaca order was sent.",
    "fills": [],
    "equityNote": "Not a performance record.",
}


def scrub(text: str) -> str:
    secret = os.environ.get("XAI_API_KEY") or ""
    if secret:
        text = text.replace(secret, "[redacted]")
    return text[-4000:]


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    report = OUT / "experiment.json"
    if not BIN.exists():
        payload = {"ok": False, "blocker": f"Hermes console is not installed at {BIN}."}
        report.write_text(json.dumps(payload))
        print(json.dumps(payload))
        raise SystemExit(2)
    if HOME.exists():
        shutil.rmtree(HOME)
    skill_root = HOME / "skills"
    for spec in sorted(SKILLS.glob("*.md")):
        dest = skill_root / spec.stem
        dest.mkdir(parents=True)
        body = spec.read_text()
        dest.joinpath("SKILL.md").write_text("---\nname: " + spec.stem + "\ndescription: Apex research skill. Cannot approve itself.\n---\n" + body)
    (HOME / "journal.json").write_text(json.dumps(JOURNAL))
    before = {path: path.stat().st_mtime_ns for path in [Path("/workspace/.grok/paper-credentials.json")] if path.exists()}
    env = {key: value for key, value in os.environ.items() if not key.startswith("APCA_") and "PAPER" not in key}
    env["HOME"] = str(HOME)
    env["HERMES_HOME"] = str(HOME)
    prompt = (
        "Read the four Apex skills under skills/ if your skill tool can see them. "
        "The journal at journal.json is synthetic and has no fills. "
        "Reply with one JSON object only, keys id, hypothesis, baselineId, selfDeclaredSuccess. "
        "selfDeclaredSuccess must be false. Do not claim a profit, a probability, or an approved order. "
        "Do not ask for or write credentials. Do not change risk limits."
    )
    proc = subprocess.run(
        [str(BIN), "--oneshot", prompt, "--provider", "xai", "--model", "grok-4.20-0309-non-reasoning", "--toolsets", "skills", "--usage-file", str(OUT / "usage.json")],
        cwd=str(HOME),
        env=env,
        capture_output=True,
        text=True,
        timeout=180,
        check=False,
    )
    touched = []
    for path, stamp in before.items():
        if path.exists() and path.stat().st_mtime_ns != stamp:
            touched.append(str(path))
    text = scrub((proc.stdout or "") + "\n" + (proc.stderr or ""))
    experiment = None
    start = (proc.stdout or "").find("{")
    end = (proc.stdout or "").rfind("}")
    if start >= 0 and end > start:
        try:
            experiment = json.loads(proc.stdout[start : end + 1])
        except json.JSONDecodeError:
            experiment = None
    declared = bool(experiment and experiment.get("selfDeclaredSuccess") is True)
    ok = proc.returncode == 0 and isinstance(experiment, dict) and experiment.get("selfDeclaredSuccess") is False and not touched and not declared
    payload = {
        "ok": ok,
        "engine": "hermes",
        "commit": "eaac327fac2c2db0b77ee143989d49b29a6f36cb",
        "version": "0.0.0",
        "code": proc.returncode,
        "selfDeclaredSuccess": False if experiment is None else experiment.get("selfDeclaredSuccess"),
        "experiment": experiment,
        "credentialsTouched": touched,
        "placeOrders": False,
        "skills": [path.name for path in skill_root.iterdir()] if skill_root.exists() else [],
        "blocker": None if ok else scrub(text)[-1200:],
        "ranAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    report.write_text(json.dumps(payload))
    print(json.dumps({"ok": ok, "code": proc.returncode, "experiment": experiment, "skills": payload["skills"]}))
    raise SystemExit(0 if ok else 1)


if __name__ == "__main__":
    main()
