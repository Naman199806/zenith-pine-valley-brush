# Security and compliance

This build is a research console for a simulated book. It is not an investment adviser, broker-dealer, or customer platform. It does not take deposits, give personalized advice, or custody assets.

Controls that exist:

- Live mode cannot be turned on.
- Orders carry `live: false`.
- No API keys in the client or the repository.
- Agent tools that would change limits are denied and audited.
- External text is not passed into a trading tool, because no external text is fetched.
- Fixture inputs that fail the bar checks are quarantined instead of repaired.

Controls that are not claimed:

- Multi-factor authentication for administrators. There is no account system in this deployment.
- A tamper-proof external audit log. The audit trail lives in the simulated book.
- Regulatory approval for equities, futures, swaps, or event contracts.
- Customer-order routing. Do not point this at someone else’s money.

US equities, futures, and FX would later need the relevant SEC, FINRA, CFTC, NFA, exchange, and broker constraints reviewed for the actual account. That review has not been done.
