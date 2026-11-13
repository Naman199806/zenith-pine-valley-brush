# Strategy research

Promotion path: IDEA, EXPERIMENT, BACKTESTED, VALIDATED, PAPER, SHADOW, LIVE_ELIGIBLE, LIVE. SUSPENDED and RETIRED are not forward steps. Nothing in this build can move forward. Live is locked.

## Preserved record

Sprint 1, four intraday strategies: stopped before validation. The recovered commit says they were not live-feasible on free data, with negative development and replication. State: RETIRED. Numbers were not in the bundle and are not reconstructed.

Sprint 2: recovered merge “S1 stopped, S2 holdout results.” The draft protocol says S2 faded after publication and S1 lost to costs. State: RETIRED. Numbers not reconstructed.

Sprint 3, drafted 2026-11-11 and not frozen: T1 ETF time-series momentum on a fixed basket, and T2 SPY/QQQ overnight drift. State: IDEA. Not scored. The data questions were answered on 2026-11-12 without computing a return. See below. The answers do not freeze the protocol.

## Sprint 3 data answers (no results)

Fetched 2026-11-12T03:15:31Z from Yahoo’s chart API, daily interval, explicit `period1`/`period2`. A `range=max` request was discarded because it returned about one bar a month. Raw coverage, not prices, is in `research/data/yahoo-daily-coverage.json`.

1. History before 2016. Yahoo has daily open, high, low, close before 2016 for every name in the draft. SPY starts 1993-01-29 (8,505 bars). QQQ starts 1999-03-10. The T1 basket without BIL starts together on 2006-02-06 (DBC). With BIL, the common start is 2007-05-30. T2 cannot start in February 1993 because QQQ did not exist. Stooq did not return prices (browser challenge). Nasdaq’s historical endpoint returned zero rows. Alpaca was not available, so the required 2016–2026 comparison was not run. One vendor is not enough to freeze.
2. Dividends. TLT has 290 cash dividends and IEF 292. GLD has none. SPY has 136, and its adjusted close differs from the close on 8,466 of 8,505 bars. Bond ETFs cannot be researched on price alone. Yahoo’s adjusted close is rescaled when later dividends arrive, so it is not a point-in-time series. Total return has to be built from the close plus dividends whose ex-date is already known. That identity is tested on made-up numbers. It has not been applied to these ETFs.
3. Auction cost. Not measured. A daily open and close are not an auction-versus-book spread. The old cost-model figures were not in the recovered bundle and are not invented here.
4. Pattern-day-trader status. T2 buys one session’s close and sells the next session’s open, so it is not a same-day round trip under the old rule. T1 rebalances monthly. No broker account was checked, and a broker can still impose its own margin rule.

Until Alpaca (or another second source) is compared, auction cost is measured, and the draft dates are rewritten, T1 and T2 stay IDEA.

## Cost control

`orb-cost-control` is a constructed path, dataset `ILLUSTRATIVE_COST_DRAG_V1`. Every session is identical. The breakout fills at the next bar’s open, four cents higher at the exit, with 8 bps charged per side. Gross return is positive at 0 bps. Net return is negative at 8 bps and worse at 16 bps. Sharpe is undefined because variance is zero, so a ratio cannot promote it. State: RETIRED. Do not edit the path to flip the sign.

A seeded noise walk (`SYNTHETIC_NOISE_V1`, seed 20261111) exists only to show that a random sign is still not evidence. It is not a registered promotion candidate.

## Other families

Trend, cross-sectional momentum, mean reversion, pairs, variance premium, defined-risk spreads, carry, factor rotation, event-driven, market making, and cross-venue arbitrage are IDEA records with a hypothesis and no sample.

`paper-mechanics` is not an alpha strategy. It may place a simulated ETF ticket inside the risk caps. It cannot advance past PAPER. Fills are not performance.
