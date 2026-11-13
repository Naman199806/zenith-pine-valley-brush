# Risk policy

Rules version `paper-defaults-v1`. These are paper defaults, not a claim that the same numbers are safe with real money.

| Rule | Setting |
| --- | --- |
| Mode | RESEARCH until an operator enables PAPER. LIVE cannot be enabled. |
| Risk per trade | 0.25% of equity, from the stated stop. Size is reduced, not waived. |
| Daily loss | Alert at 0.5%. Block new risk at 1%. |
| Drawdown | Review flag at 5%. Block new risk at 8%. The block cannot be released while drawdown is still past 8%. |
| Strategy cap | 10% of equity. |
| Same factor | An add is rejected, not resized, once that factor is already 8% of equity. |
| Leverage, shorts, naked options | Off. |
| Averaging down | Off unless a new validated signal is flagged. Plumbing never flags one. |
| Stale, halted, or unmatched data | New risk blocked. Closing a long is still a reduce. |
| Expired credentials or a venue withdrawal halt | New risk blocked. |
| Order rate | 10 intents in 60 seconds. |
| Kill switch | Block new risk, request cancels, or request a flatten. None of these set “positions confirmed flat.” |

The risk officer on the research desk is advisory. `evaluateRisk` is the decision that stamps `riskDecisionId` on an order.
