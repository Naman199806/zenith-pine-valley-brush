# Engineering plan

## Done in this slice

Stage 0. The workspace had no Apex tree. The attached git bundle was incremental and lacked its parent commits, so only a few objects unpacked: the sprint 3 draft protocol, phone-alert source, a detach script, and commit messages for sprint 1, sprint 2, and the alert work. Those are preserved under `research/prior/`. Nothing from that record was relabeled as a profit.

Stage 1. Domain model, ledger, registry, risk engine, order state machine, reconcile, kill switch.

Stage 2. A control backtest with costs, quarantine, splits, and walk-forward folds. Not LEAN. Sprint 3 coverage was fetched and the four data questions were answered. T1 and T2 were not run.

Stage 3. Structured desk with the twelve roles and a hard submit boundary. Not TradingAgents itself.

Stage 4, partial. Paper simulator for five ETFs, from ticket to fill to position. Reference path for later markets.

## Sprint 3A

Yahoo raw daily snapshots and a checksum manifest exist for six ETFs. A second OHLCV source is blocked. Corporate-action validators exist and are tested. Git parents `25e4431` and `1c0d932` are irrecoverable from available sources. LEAN is pinned and not runnable here. Freqtrade and Backtrader stay out of the process (GPL). See `docs/DATA_INTEGRITY.md`, `docs/EVIDENCE_RECOVERY.md`, `docs/LEAN_INTEGRATION.md`, and `docs/LICENSING_FREQTRADE_BACKTRADER.md`.

## Not done

A second daily vendor, a frozen sprint 3, any T1 or T2 result, a running LEAN process, crypto execution, futures margin, option chains, prediction venues, and any live broker.

## Order of the next work

1. Do not score T1 or T2 until a second OHLCV tape is actually compared and the draft windows are rewritten.
2. Keep building total return from the close plus dividends whose ex-timestamp was already known. Do not signal on `yahooAdjClose`.
3. LEAN only after a .NET 10 host exists. The fixture smoke is not that host.
4. Broker paper only if a vendor is chosen and keys are explicitly approved. Still not live.

