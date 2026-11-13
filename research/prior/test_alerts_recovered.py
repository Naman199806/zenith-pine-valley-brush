"""Phone alerts: ntfy and Telegram payloads, silence without config, never raising, and the paper loop's alerts."""

import json

import pandas as pd

from apex_quant import alerts


def test_ntfy_and_telegram_payloads_and_no_config(tmp_path):
    calls = []
    post = lambda url, **kw: calls.append((url, kw))  # noqa: E731
    cfg = tmp_path / "alerts.json"
    assert alerts.notify("t", "m", path=cfg, post=post) is False and calls == []
    cfg.write_text(json.dumps({"ntfy_topic": "apex-abc", "telegram_token": "TKN", "telegram_chat_id": "42"}))
    assert alerts.notify("APEX nightly: FAILED", "no decisions", "high", path=cfg, post=post)
    (u1, k1), (u2, k2) = calls
    assert u1 == "https://ntfy.sh/apex-abc" and k1["headers"]["Priority"] == "5" and k1["data"] == b"no decisions"
    assert u2 == "https://api.telegram.org/botTKN/sendMessage" and k2["json"]["chat_id"] == "42"


def test_a_failing_alert_never_raises(tmp_path):
    cfg = tmp_path / "alerts.json"
    cfg.write_text(json.dumps({"ntfy_topic": "x"}))

    def boom(*a, **k):
        raise ConnectionError("offline")
    assert alerts.notify("t", "m", path=cfg, post=boom) is False


def test_paper_loop_alerts_each_critical_event_once_and_sends_one_eod_summary(tmp_path, monkeypatch):
    from tests.test_runner import make

    sent = []
    monkeypatch.setattr(alerts, "notify", lambda title, msg, priority="default", **k: sent.append((title, priority)))
    trader, broker, data, store, clock = make(tmp_path)
    trader.day = pd.Timestamp("2026-10-28", tz="America/New_York")
    store.event("CRITICAL", "daily_loss_limit", "equity down 1%")
    store.event("INFO", "watchlist", "x")
    rep = type("R", (), {"action": "tick"})()
    trader._alerts(rep)
    trader._alerts(rep)
    assert sent == [("APEX paper: daily_loss_limit", "high")]
    rep.action = "eod"
    trader._alerts(rep)
    trader._alerts(rep)
    assert [t for t, _ in sent].count("APEX paper: day closed") == 1
