"""One capped TradingAgents propagate() call. Research only. No broker.

The xAI key is read from the environment by the library. This script redacts it.
"""
import json
import os
import traceback
from datetime import datetime, timezone
from pathlib import Path

OUT = Path("/workspace/.runtimes/tradingagents-run")
OUT.mkdir(parents=True, exist_ok=True)
REPORT = OUT / "invoke.json"


def scrub(text: str) -> str:
    secret = os.environ.get("XAI_API_KEY") or ""
    if secret:
        text = text.replace(secret, "[redacted]")
    return text[-4000:]


def main() -> None:
    if not os.environ.get("XAI_API_KEY"):
        REPORT.write_text(json.dumps({"ok": False, "blocker": "XAI_API_KEY is not set. No research report was invented."}))
        print(REPORT.read_text())
        raise SystemExit(2)
    from tradingagents.default_config import build_default_config
    from tradingagents.graph.trading_graph import TradingAgentsGraph
    import tradingagents

    cfg = build_default_config()
    cfg.update(
        {
            "llm_provider": "xai",
            "deep_think_llm": "grok-4.20-0309-non-reasoning",
            "quick_think_llm": "grok-4.20-0309-non-reasoning",
            "backend_url": "https://api.x.ai/v1",
            "max_debate_rounds": 1,
            "max_risk_discuss_rounds": 1,
            "max_tool_rounds": 1,
            "max_recur_limit": 20,
            "max_tokens": 400,
            "temperature": 0,
            "checkpoint_enabled": False,
            "llm_max_retries": 0,
            "results_dir": str(OUT / "results"),
            "data_cache_dir": str(OUT / "cache"),
            "memory_log_path": str(OUT / "memory.md"),
            "output_language": "English",
            "news_article_limit": 2,
            "global_news_article_limit": 1,
            "global_news_lookback_days": 2,
        }
    )
    payload = {
        "ok": False,
        "engine": "tradingagents",
        "version": getattr(tradingagents, "__version__", "unknown"),
        "provider": "xai",
        "model": cfg["quick_think_llm"],
        "ticker": "AAPL",
        "tradeDate": "2024-01-05",
        "analysts": ["market"],
        "placeOrders": False,
        "executable": False,
        "ranAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    try:
        graph = TradingAgentsGraph(selected_analysts=["market"], debug=False, config=cfg)
        final_state, signal = graph.propagate("AAPL", "2024-01-05")
        decision = ""
        if isinstance(final_state, dict):
            decision = str(final_state.get("final_trade_decision") or final_state.get("investment_plan") or "")
        payload.update(
            {
                "ok": True,
                "signal": scrub(str(signal))[:240],
                "decision": scrub(decision)[:1200],
                "stateKeys": sorted(final_state.keys()) if isinstance(final_state, dict) else [],
            }
        )
    except Exception as exc:
        payload["blocker"] = scrub(f"{type(exc).__name__}: {exc}")
        payload["trace"] = scrub(traceback.format_exc())
    REPORT.write_text(json.dumps(payload))
    print(json.dumps({k: payload[k] for k in payload if k != "trace"}))
    raise SystemExit(0 if payload["ok"] else 1)


if __name__ == "__main__":
    main()
