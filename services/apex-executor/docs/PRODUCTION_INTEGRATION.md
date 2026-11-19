# Production integration

This branch is the PAPER enablement draft. It must not be deployed and it must not be merged until reviewed. `LIVE_POST_ENABLED` and `strategyApproved` stay false. `supervisedActivation` starts closed. The disabled adapter still throws `PAPER POST DISABLED` before `fetch`. A simulated `fetch` is tagged `injected` and cannot enter the Hermes performance sink.

## What production calls

`services/apex-executor/src/main.ts` `boot` is the process entry. It recovers in-flight orders before it listens. `POST /instructions` with a signed `SUPERVISED_PAPER_TEST` order is `acceptSupervised` then `submitPaper` on the PAPER HTTP adapter, one write at a time, under the writer lock. `POST /activation` opens a signed window of at most 15 minutes. Both `PAPER_POST_ENABLED=true` and that window are required. A dev flag does not open it. A restart drops the window. LIVE is not wired.

Sequence, under the same writer lock:

1. `runBrokerPoll` spends the non-reserve budget (4 snapshot GETs plus 3 per in-flight order). A poll that would enter the 10-request reserve is skipped. Stale evidence does not authorize anything.
2. `recoverInFlight` runs for every `UNKNOWN` or in-flight id. Each attempt is 4 recovery GETs: order by client id, open orders, all orders, and FILL activities. Default 3 attempts, backoff 250ms. One 404 does not clear `UNKNOWN`. The id stays in `health().unknownClientOrderIds` and blocks new ids.
3. A signed `market_notional` buy is `acceptSupervised` then `submitPaper`. The body is `exactBrokerBody`. A limit ticket is refused. The entry cannot spend the reserve. Freshness, expiry, kill switch, reconciliation, and budget are read again immediately before `fetch`.
4. A signed `market_qty` sell is accepted only when it names a journaled filled entry of the same symbol. `submitPaper` GETs positions, then rechecks freshness, expiry, remaining quantity minus pending sells, and budget, then writes. The kill switch does not replace that signature.
5. Cancel is a budgeted GET by client order id, then `DELETE /v2/orders/{order_id}`, then GET until the broker reports `canceled`, `filled`, or `partially_filled`. The body is the broker GET. Nothing writes `filled_qty: 0` locally. Each of those requests spends the shared budget. Alpaca's trading API does not cancel by client order id directly ([Delete Order by ID](https://docs.alpaca.markets/us/reference/deleteorderbyorderid-1)). FILL reads follow `page_token` and `direction` until a short page ([Activities by type](https://docs.alpaca.markets/us/reference/getaccountactivitiesbyactivitytype-1)). A full page left unread is not absence. Every request uses an `AbortController` deadline. A POST timeout is `UNKNOWN` and is not posted again.
6. Fills are `filled_qty`, `filled_avg_price`, and `status` on the order, plus FILL activities ([Account Activities](https://docs.alpaca.markets/us/docs/account-activities)). The operational record keeps order id, activity id, qty, price, time, and provenance even when the fee is omitted. `feeKnown: false` means net profit is not attributable. A fee field that is numerically 0 is a known zero. `hermesPerformanceRefusal` drops injected rows and unknown fees. `SUPERVISED_PAPER_TEST` rows never enter strategy qualification. The channel on a real response is `alpaca-http`.

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

`cursor/paper-enablement-proposal-837c` at `1b1c614aff1bb9866fef87badc5c4beda615b7c2` adds `src/production-cycle.ts` and `test/production-cycle.test.ts`. `createHttpPaperWriter` calls `fetch` for POST `/v2/orders`, GET by client order id, list orders, positions, FILL activities, and DELETE `/v2/orders/{order_id}`. `runSupervisedPaperCycle` recovers, then submits. Tests replace `fetch` and check that the POST body equals `exactBrokerBody`, that the host is `paper-api.alpaca.markets`, and that a stale order does not POST. The disabled adapter on that branch still throws before `fetch`. This PR does not contain that HTTP writer.
