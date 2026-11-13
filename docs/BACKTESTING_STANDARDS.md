# Backtesting standards

A result is usable only if a later run on the same inputs reproduces it.

## Rules that are enforced

- A signal on bar t fills at the next bar’s open. The illustrative control asserts this.
- A bar that is out of order, duplicated, non-positive, or impossible is quarantined.
- A split whose ex-date is after the as-of timestamp does not rewrite earlier bars.
- A cash dividend whose ex-date is after the as-of timestamp is not added into a holding’s total return.
- Costs are charged on the way in and the way out. The control is shown at 0, 8, and 16 bps.
- Folds are chronological. The control does not shuffle days.
- A zero-variance path does not produce a Sharpe ratio and cannot be promoted.
- Identical sessions are labeled constructed. They are not a market sample.

## Not yet enforced on a real history

Walk-forward on a multi-year equity tape, deflated Sharpe across a real trial count, borrow fees, and option assignment. Yahoo adjusted close must not be used as a signal input: the vendor rewrites it when a new dividend is paid. Build total return from the close and from dividends already known.

No profit factor, Sharpe, or win rate is sufficient on its own.
