# Apex Quant X — dual-bot boundary

Apex Quant X owns stages 1–4 and proposes a typed `TradeInstruction`.
Apex Executor owns stage 5 and is the only process that may submit.
Hermes owns stage 6 and cannot approve trading.

Current state: Executor service exists. PAPER read-only. POST hard-disabled.
strategyApproved remains false. No order has been submitted.
