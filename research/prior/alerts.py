"""Phone alerts, best-effort and free: ntfy (no account; install the ntfy app and subscribe to your topic) or a
Telegram bot. Configure in ~/.apex/alerts.json, e.g. {"ntfy_topic": "apex-<random>"} or
{"telegram_token": "...", "telegram_chat_id": "..."}. An alert never raises and never blocks trading for long.
Messages carry status only: never keys, never account numbers."""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path

import requests

log = logging.getLogger("apex.alerts")
CONFIG = Path.home() / ".apex" / "alerts.json"


def settings(path: Path = CONFIG) -> dict:
    s = {}
    if path.exists():
        try:
            s = json.loads(path.read_text())
        except Exception as exc:
            log.warning("alerts config unreadable: %s", exc)
    for k, env in (("ntfy_topic", "APEX_NTFY_TOPIC"), ("telegram_token", "APEX_TELEGRAM_TOKEN"),
                   ("telegram_chat_id", "APEX_TELEGRAM_CHAT_ID")):
        if os.environ.get(env):
            s[k] = os.environ[env]
    return s


def notify(title: str, message: str, priority: str = "default", path: Path = CONFIG, post=requests.post) -> bool:
    """priority: 'low', 'default' or 'high' (high = a halt, a failure, a loss limit)."""
    s = settings(path)
    sent = False
    try:
        if s.get("ntfy_topic"):
            server = s.get("ntfy_server", "https://ntfy.sh").rstrip("/")
            post(f"{server}/{s['ntfy_topic']}", data=message.encode("utf-8"), timeout=5,
                 headers={"Title": title.encode("ascii", "replace").decode(), "Priority": {"low": "2", "high": "5"}.get(priority, "3"),
                          "Tags": "rotating_light" if priority == "high" else "chart_with_upwards_trend"})
            sent = True
        if s.get("telegram_token") and s.get("telegram_chat_id"):
            post(f"https://api.telegram.org/bot{s['telegram_token']}/sendMessage", timeout=5,
                 json={"chat_id": s["telegram_chat_id"], "text": f"{title}\n{message}"})
            sent = True
    except Exception as exc:                    # best-effort: an alert failure must never stop a run
        log.warning("alert not sent: %s", exc)
        return False
    return sent
