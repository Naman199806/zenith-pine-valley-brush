# Sprint 3 protocol: DRAFT (not frozen; 2026-11-11)

Nothing here binds until it is reviewed, the open questions in section 5 are answered **without looking at any strategy
result**, and the frozen version is committed with registry entries. Lessons from sprint 2 are built in.

## 1. Why a slower track

Every intraday candidate so far failed after realistic costs (sprint 1: four; sprint 2: S2 faded after publication, S1
lost to costs and cannot select stocks on free live data). Strategies that hold for days to weeks have stronger
long-run evidence, costs are small relative to the moves they target, and daily data is complete and identical live and
in backtests (official opening and closing auction prices).

## 2. Candidates (m = 2)

**T1. Time-series momentum (trend following) on a fixed basket of liquid ETFs.** Basis: Moskowitz, Ooi & Pedersen
(2012, "Time Series Momentum"); Hurst, Ooi & Pedersen (2017, "A Century of Evidence on Trend-Following Investing").
- Basket (fixed in advance, all asset classes): SPY, EFA, EEM, TLT, IEF, GLD, DBC, VNQ.
- Month-end signal: the sign of each ETF's 12-month total return in excess of T-bills (BIL). Long if positive, flat
  otherwise (no shorts: no borrow costs or availability risk).
- Size: each long position targets 10% annualized volatility (60-day realized), the total capped at 100% of equity.
  Rebalance at the next session's opening auction.
- About 8 trades a month. Expected cost per year: a few basis points.

**T2. Overnight drift on SPY and QQQ.** Basis: Cooper, Cliff & Gulen (2008, "Return differences between trading and
non-trading hours"); Lou, Polk & Skouras (2019, "A tug of war: Overnight versus intraday expected returns").
- Buy at the closing auction, sell at the next opening auction, every session. 1x notional, no leverage.
- Live fills match the backtest exactly: Alpaca supports market-on-close and market-on-open orders, and the backtest
  uses the official auction prices.
- Main risk: a small edge per trade (a few basis points) against about 1 basis point of cost, and post-publication
  decay.

## 3. Periods (one-way; each run once)

| | T1 | T2 | Use |
| --- | --- | --- | --- |
| Development | first common date (about 2006-03) – 2012-12 | 1993-02 – 2011-12 | Implementation checks |
| Validation | 2013-01 – 2019-12 | 2012-01 – 2018-12 | After the papers' samples |
| Holdout | 2020-01 – 2026-10 | 2019-01 – 2026-10 | Run once after validation |
| Forward paper | after a PASS | after a PASS | Final confirmation |

## 4. Gate (all must hold)

1. Out-of-sample (validation + holdout) observations: T1 at least 120 months; T2 at least 1,500 sessions.
2. Mean net return: 97.5% moving-block bootstrap CI lower bound > 0 (block 3 months for T1, 5 sessions for T2).
3. Mean net return > 0 in validation and in holdout separately.
4. Mean net return > 0 with costs doubled.
5. **Deflated Sharpe ratio ≥ 0.95** out of sample, counting every strategy APEX has evaluated (7 including these two),
   with the trial-Sharpe spread fixed in advance at an annualized 0.5 (the report also shows 1.0).
6. Maximum drawdown: T1 ≤ 25% (at its 10% volatility target); T2 ≤ 15% (at 1x).

## 5. Open questions (answer before freezing; data checks only, no strategy results)

1. **History before 2016.** Alpaca's free data starts in 2016. Is there a free, reliable daily source back to the
   ETFs' launches (e.g. Stooq), with total-return (dividend-adjusted) prices for T1 and unadjusted open/close for T2?
   Check: compare it with Alpaca over 2016–2026; differences beyond a tolerance stop the sprint.
2. **Dividends.** T1 needs total returns: bond ETFs earn much of their return as dividends. T2 holds overnight into
   ex-dates: the price falls at the open by about the dividend, which the overnight holder receives. With unadjusted
   prices the dividend must be added back on those nights, or T2's return is understated (and a day-by-day check with
   settlement rules confirms the holder of record).
3. **Auction cost.** Measure the opening and closing auction cost for SPY and QQQ from free data, or justify cost model
   v2's figures for auction orders.
4. **Pattern-day-trader status.** T2 opens and closes on different days, so it is not a day trade. T1 is monthly.
   Neither should be restricted by the old rule or by the broker's intraday-margin replacement.
