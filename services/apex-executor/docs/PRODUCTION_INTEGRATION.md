# Production integration

PR #8 does not enable a broker write. `REAL_BROKER_WRITE_ENABLED` stays false. The adapter throws `PAPER POST DISABLED` before `fetch` on POST, PATCH, and DELETE. `PAPER_POST_ENABLED`, `LIVE_POST_ENABLED`, and `strategyApproved` stay false.

The proposed wiring lives on branch `cursor/paper-enablement-proposal-837c`. That branch is not a pull request and must not be deployed. This file is the contract that branch implements.

## What production calls

`services/apex-executor/src/main.ts` boots one `Executor`, takes the writer lock, and runs `PollScheduler`. It does not submit from `POST /instructions`. That route only ingests.

After the enablement branch, the poll loop calls one driver, `runSupervisedPaperCycle`, and only when `PAPER_POST_ENABLED=true`. The driver uses the real PAPER adapter. LIVE is not wired.

Sequence, under the same writer lock:

1. `runBrokerPoll` spends the non-reserve budget (4 snapshot GETs plus 3 per in-flight order). A poll that would enter the 10-request reserve is skipped. Stale evidence does not authorize anything.
2. `recoverInFlight` runs for every `UNKNOWN` or in-flight id. Each attempt is 4 recovery GETs: order by client id, open orders, all orders, and FILL activities. Default 3 attempts, backoff 250ms. One 404 does not clear `UNKNOWN`. The id stays in `health().unknownClientOrderIds` and blocks new ids.
3. A signed `market_notional` buy is `acceptSupervised` then `submitPaper`. The body is `exactBrokerBody`. A limit ticket is refused. The entry cannot spend the reserve. Freshness, expiry, kill switch, reconciliation, and budget are read again immediately before `fetch`.
4. A signed `market_qty` sell is accepted only when it names a journaled filled entry of the same symbol. `submitPaper` GETs positions, then rechecks freshness, expiry, remaining quantity minus pending sells, and budget, then writes. The kill switch does not replace that signature.
5. Cancel is `DELETE /v2/orders/{order_id}` after the id is known from a GET. It may use the reserve. Alpaca's trading API does not cancel by client order id directly ([Delete Order by ID](https://docs.alpaca.markets/us/reference/deleteorderbyorderid-1)).
6. Fills are `filled_qty`, `filled_avg_price`, and `status` on the order, plus FILL activities ([Account Activities](https://docs.alpaca.markets/us/docs/account-activities)). No fee field means `feeKnown: false` and `fee: null`. `hermesPerformanceRefusal` drops injected rows and unknown fees. The channel on a real response is `alpaca-http`.

Errors: timeout, 429, and 5xx become `UNKNOWN` and are not retried. The journal is fsynced before the POST. A crash after that line recovers by GET, not by a second POST.

## Alpaca documents

- Create order: https://docs.alpaca.markets/us/reference/postorder
- Get by client order id: https://docs.alpaca.markets/us/reference/getorderbyclientorderid
- List orders: https://docs.alpaca.markets/us/reference/getallorders-1
- Delete order by id: https://docs.alpaca.markets/us/reference/deleteorderbyorderid-1
- FILL activities: https://docs.alpaca.markets/us/docs/account-activities
- FILL by type, filterable by `order_id`: https://docs.alpaca.markets/us/reference/getaccountactivitiesbyactivitytype-1
- Fractional constraints: https://docs.alpaca.markets/us/docs/fractional-trading

## Absence rule

See `src/absence.ts`. Absence is at least two, and by default three, clean misses: HTTP 404 by client order id, open orders 200 without that id and not truncated at 500, all-orders 200 without that id and not truncated, and FILL activities 200 with no FILL for a known broker order id. A timeout or a 5xx ends the window as `UNKNOWN`. The operator resolves that by hand. The process does not mint a replacement id.

## Enablement branch

`cursor/paper-enablement-proposal-837c` adds `production-cycle.ts` and an HTTP adapter that calls `fetch` for the sequence above. Tests replace `globalThis.fetch` and assert method, URL, and body. They do not flip the guard by deleting the check without a test. This PR's tree does not contain that adapter's live call.
