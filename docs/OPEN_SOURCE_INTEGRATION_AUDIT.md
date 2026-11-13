# Open-source integration audit

Inspected 2026-11-11 from current upstream READMEs, license files, and release metadata. None of these trees were cloned into this application, and none were executed here. “Not integrated” means there is no adapter, no pinned checkout, and no passing integration test.

| Project | License | Pin inspected | Decision | Why |
| --- | --- | --- | --- | --- |
| QuantConnect/Lean | Apache-2.0 | `master` moving; commit noted on the repo page as `054ec05` on 2026-11-10. Not pinned in-tree. | Future isolated research runtime | Event-driven multi-asset engine. C# plus Python algorithms. Needs the .NET SDK. Do not fold it into this process. |
| TauricResearch/TradingAgents | Apache-2.0 | Release line v0.7.1 (2026-10-27) as published on the repo. Not installed. | Concept, later a service | Analyst, bull, bear, trader, and risk roles. Output is a research decision for a simulator. Non-deterministic. Must not receive order tools. |
| NousResearch/hermes-agent | MIT | Release v0.23.1 (2026-11-10) as published. Not installed. | Concept only | General agent with skills, memory, and cron. Not a quant library. Shell and unsandboxed tools are out of scope. |
| freqtrade/freqtrade | GPL-3.0 | Release 2026.10 (2026-10-30). License file confirmed. | Separate process or nothing | Crypto spot and futures dry-run. Copyleft forbids vendoring into this app. |
| mementum/backtrader | GPL-3.0 | Version line 1.9.78.123. Last commit on master dated 2023-04-19. Pushed ~2023, not maintained through 2026. | Concept only | Useful as a second implementation of a backtest, not as the primary engine, and not vendored. Maintenance is stalled. |
| Jakeschincariol/day-trader-skill | MIT | Tree updated 2026-10-20. Not installed. | Concepts only | Scanner, news, entry, exit, and a time-machine replay. Paper by default. Explicit human approval. Stdlib only. Yahoo data is not a live feed. |

## Duplication to avoid

- Do not run LEAN and Backtrader as two sources of portfolio truth.
- Do not let Freqtrade and this ledger both believe they own a position.
- Do not treat a TradingAgents paragraph as an order.
- Do not copy Day Trader Skill’s file-drop workflow. Use typed decisions.

## Integration rule

A framework is “integrated” only after a contract test passes against a pinned commit. Until then the operations screen says not integrated.

Freqtrade and Backtrader licensing, including GPL-3.0-only versus GPL-3.0-or-later, is in `docs/LICENSING_FREQTRADE_BACKTRADER.md`. That review is not legal advice. Neither tree was installed.
