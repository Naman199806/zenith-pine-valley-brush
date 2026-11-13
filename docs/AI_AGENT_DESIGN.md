# AI agent design

Twelve roles: scanner, technical, fundamental, macro, news, derivatives, bull, bear, quantitative validator, portfolio manager, risk officer, execution planner.

They return a stance and a sentence tied to an evidence id. Evidence carries a timestamp and a source. The current desk is deterministic on purpose. A sampled model is not asked for prices, balances, or fills, because those would be invented.

Cases the desk actually runs:

- SPY plumbing. Approved only in paper, and only as a pipe test.
- QQQ added to a book that is already long SPY. Rejected on factor exposure.
- MES future. Rejected. Leveraged, and a stress loss that happens to fit the budget still does not open the gate.
- Event contract. Rejected because resolution is marked ambiguous.
- Crypto gap of 12 bps. Rejected because fees, network, and withdrawal sum to more than that.
- Bull versus bear. The bull can support and the bear can block. The engine blocks, and the agent’s draft is not submitted.

An agent actor on `applySubmission` is rejected. `agentTool("setRiskLimit")` writes an audit line and changes nothing.

TradingAgents can later fill the prose. Hermes can later schedule research. Neither gets a tool that calls `applySubmission`.
