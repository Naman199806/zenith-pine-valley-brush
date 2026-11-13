# Acceptance criteria

`runAcceptance` in `src/lib/apex/drills.ts` is the machine-readable suite. The operations screen runs the same function. The unit test fails if any check fails.

Covered:

- Illustrative breakout loses after 8 bps and loses more after 16. Zero cost is positive.
- Entry fill ignores bars after the signal bar.
- Retired and draft strategies cannot skip gates. Live cannot be selected.
- Research mode rejects. Rejected orders have no fills.
- Paper fills are not live, carry a strategy version and a risk id, and replay to the same cash.
- The same idempotency key cannot create a second fill.
- Unapproved strategy versions, unknown symbols, hallucinated prices, and agent actors are rejected.
- An agent cannot change a limit.
- Stale data, halted data, a broken reconcile, expired credentials, a withdrawal halt, and a 1% daily loss block new risk.
- A same-factor add on top of SPY is blocked.
- A lost ack is not blindly retried. Reconcile applies one fill.
- A rejected cancel does not mark the book flat.
- A gap fill is worse than the stop.
- Option assignment becomes stock exposure.
- Restart keeps the open position. A flatten request while disconnected does not report flat.
- Bad bars are quarantined. A future split is not applied early.
- Crude expiry inside 14 days warns, with no auto-roll.
- Desk cases for conflict, negative crypto carry, closed futures, and ambiguous events block.
- Plumbing is blocked in research and can be approved in paper.

Not covered, because the feature does not exist: live broker disconnect during a real cancel, exchange partial outage beyond the halted-data flag, and load tests.
