# Hermes journal contract note for Cursor

Research can read Executor journal lines. Current lines (`ACCEPTED`, `BROKER`, `EXIT_AUTHORIZED`) do not contain fill price, fill ID, fee, or broker order ID.

Until Executor emits those fields, `adaptExecutorJournal` marks every current line incomplete. Research will not invent fills from them.

Requested fields, when Cursor is ready:
- decisionId
- strategyVersion
- clientOrderId
- brokerOrderId
- fillId
- symbol, side, qty, fillPrice, intendedPrice, fee
- source: PAPER or LIVE

Research will not edit Executor to add them.
