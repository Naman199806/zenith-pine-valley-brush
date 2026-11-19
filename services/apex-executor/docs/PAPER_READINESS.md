# PAPER readiness audit

Audit of `main` at `dd0bbc3c` (executor behavior unchanged since `662ef288`, PR #3). Evidence is from that tree, before the lifecycle work on this branch. Status values are `present`, `partial`, or `missing`. Line numbers refer to that baseline.

This branch does not enable a real broker write. `PAPER_POST_ENABLED`, `LIVE_POST_ENABLED`, and `strategyApproved` stay false in code. `REAL_BROKER_WRITE_ENABLED` stays false, so the Alpaca adapter throws before `fetch` on POST, PATCH, and DELETE.

## 1. Signed, single-use PAPER authorization

**Status: partial**

- Operator HMAC, version, expiry, and the `STRATEGY_TRADE` block: `services/apex-executor/src/approval.ts:54-64`.
- Incomplete tickets are refused rather than filled in: `approval.ts:71-114`.
- Sigma and Sentinel come from the gate proof, not caller booleans: `services/apex-executor/src/instruction.ts:30-49`.
- Accept stores the nonce and `clientOrderId`, journals, then fsyncs the snapshot: `services/apex-executor/src/runtime.ts:395-411`.
- Restart reloads nonces and ids from that snapshot: `runtime.ts:166-173`.
- Replay after restart is refused: `services/apex-executor/test/executor.test.ts` ("forged approval, sigma veto, replay after restart, and a second writer are rejected").

Gap: the journal line writes `nonce: null` (`runtime.ts:218`), so replay protection lives in the snapshot, not in the append-only journal. Nothing consumes the approval against a broker order, because no order is sent.

## 2. Durable pre-submit intent

**Status: partial**

- Each journal line is fsynced before `append` returns: `services/apex-executor/src/journal.ts:66-79`.
- The snapshot is fsynced (file, and the directory on Linux): `services/apex-executor/src/persist.ts:107-121`.
- Accept journals and saves before it returns, and `submit()` does not transmit: `runtime.ts:409-417`.

Gap: there is no intent record that is fsynced and then followed by a broker write. `submit()` returns `PAPER POST DISABLED` without a pre-write state.

## 3. Idempotent broker submission

**Status: partial**

- Duplicate nonce or `clientOrderId` is refused, and a second process cannot take a live lock: `runtime.ts:395`, `services/apex-executor/src/lock.ts:42-64`.
- Tests: the replay test above, and `executor.test.ts` ("inbox rejects a bad message, replays a good one, and does not enable POST").

Gap: `clientOrderId` is whatever the caller sent. Nothing enforces a deterministic id under 48 characters. There is no broker POST to make idempotent.

## 4. Unknown-order / timeout recovery

**Status: partial**

- A 404 on an unsent `PROPOSED` order stays `PROPOSED`. Any other missing lookup becomes `UNKNOWN`, not `FLAT`: `services/apex-executor/src/lifecycle.ts:68-78`.
- An unconfirmed attempt is labeled without transmitting: `runtime.ts:527-534`.
- The reconcile note says the order was not resubmitted: `runtime.ts:464`.
- `PROPOSED` and `SUBMISSION_ATTEMPTED` orders the broker does not have fail reconciliation and block new accepts: `runtime.ts:632-637` and `runtime.ts:542-547`.
- Tests: `executor.test.ts` ("PROPOSED stays proposed when the broker has no order…") and `test/integration.test.ts`.

Gap: there is no submit timeout path, no "GET by client_order_id, then a new approval only after confirmed absence" path, and no block that is specific to `UNKNOWN` beyond the reconciliation mismatch.

## 5. Partial and complete fill handling

**Status: partial**

- Filled quantity may not decrease: `lifecycle.ts:47-52`.
- Cumulative filled quantity drives `PARTIAL` or `OPEN`: `lifecycle.ts:88-111`.
- Execution rows are idempotent by fill id and do not use `filled_avg_price` as a print: `services/apex-executor/src/fill-event.ts:131-188`.
- Tests: `executor.test.ts` ("partial fill survives cancellation…") and `test/fill-event.test.ts`.

Gap: the journal always stores `avgPrice: null` (`runtime.ts:231`). The order record has no cumulative average.

## 6. Authorized exits and oversell prevention

**Status: partial**

- A sell requires its own signed ticket linked to the entry: `runtime.ts:480-496`.
- Sell quantity above the broker position is refused: `runtime.ts:508-509`.
- Tests: `executor.test.ts` ("partial fill survives cancellation, exit uses broker quantity…") and ("sell fill confirms flat…").

Gap: other pending sells are not subtracted from the broker quantity. The exit is stored as `PROPOSED` and is not submitted (`runtime.ts:510-524`). A short is refused only by the single-order comparison.

## 7. Broker-confirmed FLAT

**Status: present**

- FLAT requires a sell fill of the full sell quantity, position quantity 0, and no open orders: `lifecycle.ts:92-93`.
- A buy that reconciles to FLAT is forced back to `UNKNOWN`: `runtime.ts:462`.
- Tests: the exit tests in `executor.test.ts`, and `scripts/mock-lifecycle.mjs` (still `realFill: false`).

FLAT is never inferred from an empty local book alone. An unsent proposal with a 404 stays `PROPOSED`.

## 8. Hermes actual PAPER fill attribution

**Status: partial**

- Fill events are contract v1 with broker order id, fill id, qty, price, time, and fee: `fill-event.ts:16-78`.
- `provenance: "mock"` cannot be broker evidence. `trustedEvidence` drops mock rows: `fill-event.ts:70-78` and `fill-event.ts:216-224`.
- The poll path records `provenance: "broker"`: `runtime.ts:627`.
- Direct `reconcile` defaults to `"mock"`: `runtime.ts:438`.
- Tests: `test/fill-event.test.ts`.

Gap: a missing fee becomes `INCOMPLETE` (`fill-event.ts:153`). There is no explicit zero with a named source. Mock rows are labeled, and the production check rejects them, but the supervised round trip never emits a broker-proven Hermes fill because nothing is submitted.

## 9. Kill switch and Alpaca request-budget enforcement

**Status: partial**

- `entriesBlocked` refuses new buys: `runtime.ts:396`, `services/apex-executor/src/risk.ts:64-66`.
- The flag is only restored from the snapshot (`runtime.ts:178`). This process has no way to engage it.
- The 5000ms evidence cap is fixed: `services/apex-executor/src/broker-poll.ts:14-15`, `broker-poll.ts:46-48`, `broker-poll.ts:69-72`.
- The README describes the poll cost (4 Trading GETs per snapshot, 3 more per outstanding order, 20 polls/min at 3000ms) but does not enforce it: `services/apex-executor/README.md` section "Request budget".

Gap: no shared budget, no reserve, no outstanding cap, and no refusal when a call would exceed the budget. An HTTP 429 is failure kind `http` and is not retried inside one poll (`broker-poll.ts:88-91`).

## 10. Credential and PAPER/LIVE isolation

**Status: partial**

- Paper keys come from the process env or `APEX_EXECUTOR_PAPER_SECRETS_FILE`: `services/apex-executor/src/credentials.ts:34-63`.
- The live loader returns null and does not read a live file: `credentials.ts:70-79`.
- A live host is refused: `src/lib/apex/broker/allowlist.ts:11-28` and `src/lib/apex/broker/paper-read.ts:38-40`.
- Health is the frozen gate and does not echo secrets: `runtime.ts:272-307`. Tests: `executor.test.ts` ("health stays on the frozen gate") and ("corrupt state fails closed, live credentials are refused…").
- The paper poll client throws `PAPER POST DISABLED` before `fetch` on any method other than GET: `services/apex-executor/src/broker.ts:111-116`. Test: `test/broker-poll.test.ts` ("poll scenarios issue no broker POST, PATCH, or DELETE").

Gap, outside this service and not changed here: `research/lab/*.ts` and `src/lib/apex/broker/runtime.server.ts` reference `.grok/paper-credentials.json`. The executor does not read that file. Research code is not on this branch's edit list.

## After this branch

| # | Item | Before | After |
| --- | --- | --- | --- |
| 1 | Signed single-use PAPER authorization | partial | present. Nonce is journaled (`runtime.ts` audit) and reloaded from the journal on start (`absorbJournal`). `SUPERVISED_PAPER_TEST` is a separate category. `STRATEGY_TRADE` stays blocked. `strategyApproved` stays false. |
| 2 | Durable pre-submit intent | partial | present. Accept journals `intent` and fsyncs it. `submitPaper` fsyncs `submitted` before the injected writer is called. |
| 3 | Idempotent broker submission | partial | present. The signed id must match `^[A-Za-z0-9_-]{1,47}$`. The journal keeps it across a wiped snapshot. A second submit does not call the writer. |
| 4 | Unknown-order / timeout recovery | partial | present. Timeout, 5xx, and 429 become `UNKNOWN` with one attempt. `recoverInFlight` GETs by client order id. A 404 on a sent order is confirmed absence and is not resent. A new id needs a new approval. |
| 5 | Partial and complete fills | partial | present. Cumulative qty and average move only when qty increases. The same fill id is not recorded twice. A repeated average at the same qty is kept. |
| 6 | Authorized exits and oversell | partial | present. A sell needs its own signature, fresh evidence, and reconciliation. Qty must be within the broker position minus other pending sells. The kill switch does not waive those gates. |
| 7 | Broker-confirmed FLAT | present | present. Unchanged rule: sell fill, position qty 0, and no open orders. A buy is not marked FLAT from an empty local book. |
| 8 | Hermes PAPER fill attribution | partial | present for the supervised path. Broker fills carry provenance `broker`, source `PAPER`, and `feeSource` `broker` or `explicit_zero`. `productionFillProblem` rejects mock rows. The default reconcile path still labels direct test fills as mock. |
| 9 | Kill switch and request budget | partial | present. `engageKillSwitch` blocks new buys and persists. Exits stay gated. Shared budget 150/min, reserve 10, outstanding cap 1. The 5000ms cap is unchanged. |
| 10 | Credential and PAPER/LIVE isolation | partial | present inside the executor. Paper keys still come only from the VM env file. A live base URL is refused. Health has no secrets. The real write throws before `fetch`. Research files that mention `.grok/paper-credentials.json` are outside this service and are not read here. |

The real broker write remains unreachable. Tests drive an injected writer. `POST_ENABLED`, `PAPER_POST_ENABLED`, `LIVE_POST_ENABLED`, and `strategyApproved` are still false constants.

## Scope of the change

The implementation that follows stays inside `services/apex-executor/` (and `.github/workflows/executor.yml` only if CI must learn a new test file; the runner already reads the test directory).

- Order states `intent`, `submitted`, `accepted`, `partially_filled`, `filled`, `rejected`, `canceled`, `expired`, `UNKNOWN`, with illegal transitions journaled.
- A supervised path, category `SUPERVISED_PAPER_TEST`, that never sets `strategyApproved`. `STRATEGY_TRADE` stays blocked.
- Submission through an injected broker only. The real adapter still throws before `fetch` on POST, PATCH, and DELETE.
- Every submit and every exit still requires the signature, Sigma/Sentinel proof, fresh evidence, and reconciliation OK.
- The kill switch blocks new buys and does not block a separately authorized risk-reducing sell.
- Shared Trading API budget default 150/min, reserve 10, outstanding cap 1 at a 3000ms poll.
- SPY notional buy at most $25, market, `time_in_force=day`, regular hours per the broker clock. The exit sells the broker-confirmed fractional quantity. FLAT only after positions quantity 0 and no open orders.
