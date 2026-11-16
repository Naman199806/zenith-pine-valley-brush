# Hermes journal contract note for Cursor

Research can read Executor journal lines. Current Executor lines may use `kind` or `event`. Neither currently includes fill price, fill ID, broker order ID or fee. The adapter marks those lines INCOMPLETE.

Research will not treat a caller-supplied brokerOrderId or fillId as evidence unless the same identity appears in a trusted Executor-origin record.

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
