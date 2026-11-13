# Decision log

## 2026-11-11 — Recover the bundle, do not invent the missing repo

The attached bundle required commits `25e4431` and `1c0d932`, which were not present. Unpacking left the sprint 3 draft, alert code, and three commit messages. Full strategy source and numeric sprint results are unknown. Decision: preserve the text, retire those sprints without fabricating Sharpe ratios.

## 2026-11-11 — One ledger, no vendored GPL

Freqtrade and Backtrader are GPL-3.0. They are not copied in. LEAN stays a future sidecar because it is a different runtime. TradingAgents and Hermes stay outside the order path.

## 2026-11-11 — Default to research

Paper turns on only after the cost control still loses money after 8 bps and still fills on the next open. Live has no switch that works.

## 2026-11-11 — Constructed cost control, disclosed

The opening-range example is identical every day so the cost lesson does not depend on shopping a random seed. It is labeled constructed. It is retired. It is not a market result.

## 2026-11-11 — Plumbing is not an edge

The only paper strategy is `paper-mechanics` at version `plumbing-1`. That matches the older note that forward-test orders are not evidence.

## 2026-11-11 — No model calls on the desk

Deterministic notes cannot invent a price. Paying for a language model to write the same gate would not make the gate more true.

## 2026-11-12 — Answer the data questions, do not score sprint 3

Yahoo daily coverage exists before 2016, including dividends, but Alpaca was not compared, Stooq and Nasdaq did not yield a second tape, and Yahoo adjusted close is not point-in-time. BIL starts 2007-05-30 and QQQ starts 1999-03-10, so the draft windows are wrong. Decision: leave T1 and T2 at IDEA. Do not compute their returns.

## 2026-11-12 — Sprint 3A: one tape, no second price source, no LEAN process

Yahoo daily snapshots for SPY, QQQ, IWM, GLD, TLT, and BIL are checksummed. Stooq timed out and Nasdaq historical returned 403 (an earlier 200 body had zero rows). OHLCV reconciliation is blocked. LEAN master `655ac6d475ad8539ff54583a26327e63b59c5703` is Apache-2.0 and needs .NET 10, which is not installed, so the smoke test is a fixture and not a market result. Bundle parents `25e4431` and `1c0d932` are irrecoverable from the bundle and from GitHub. T1 and T2 stay IDEA. Live stays off.

## 2026-11-12 — Paper broker is a separate session, still dark

Alpaca paper is wired to `https://paper-api.alpaca.markets` only. An unauthenticated account request returned 401, so the desk stays in MONITORING and shows no account numbers. Live is not a mode. The experimental 15-minute opening-range signal is not the retired cost study and is not a claim of profit.
