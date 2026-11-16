# Apex Quant X — dual-bot boundary

Apex Quant X owns stages 1–4 and proposes a typed trade instruction.
Apex Executor owns stage 5 and is the only process that may submit.
Hermes owns stage 6 and cannot approve trading.

The six stages and the 13 agent roles are unchanged.

Stage 5 in this build:

- mode `PAPER_READ_ONLY`
- PAPER POST `DISABLED`
- LIVE POST `DISABLED`
- autonomous strategy trading `DISABLED`
- `strategyApproved` remains false

The executor verifies operator signatures and Sigma/Sentinel proofs. It does not mint them. It reconciles with the broker by `client_order_id` and does not retry an uncertain submit. No order has been submitted to Alpaca.
