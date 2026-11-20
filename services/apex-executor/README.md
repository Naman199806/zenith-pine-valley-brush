# Apex Executor

Bot 2 for Apex Quant X. Research proposes. This process is the only one that may submit, and submission is disabled.

The gate reported by `/health` is fixed in code:

- mode `PAPER_READ_ONLY`
- PAPER POST `DISABLED`
- LIVE POST `DISABLED`
- autonomous strategy trading `DISABLED`
- `strategyApproved=false`

Accepting an instruction records `PROPOSED`. It does not transmit an order and it does not mark `SUBMISSION_ATTEMPTED`. Operator proofs use `src/approval.ts`, the same module `scripts/operator-sign-ticket.mjs` uses. The signer refuses a ticket that is missing nonce, category, or authorization fields. Sigma and Sentinel are checked from a signed gate proof.

A mock lifecycle is not a broker fill:

```bash
node services/apex-executor/scripts/run-tests.mjs
node --experimental-strip-types services/apex-executor/scripts/mock-lifecycle.mjs
node services/apex-executor/scripts/typecheck.mjs
```

`npm run test:executor` calls the same runner. The mock script prints `realFill: false`. Do not treat that output as a fill.

## Windows and Node compatibility

Windows is for development and tests. Production is one Linux VM with the systemd unit. Do not point a Windows host at a broker.

CI (`.github/workflows/executor.yml`) runs the executor suite, the Hermes outcome tests, the research handoff tests, strict `tsc` on `services/apex-executor/src`, the deployment typecheck guard, and the mock lifecycle on:

- `ubuntu-latest` and `windows-latest`
- Node 22 and Node 24

A local run on Windows with Node v26.13.1 reported 9 passing and 10 failing before this hotfix. Node 26 is not a CI cell. Those failures were directory `fsync` (`EPERM` after `renameSync`) and a POSIX `sleep` child in the lock-owner test. The type-stripping flag was not the failure.

`--experimental-strip-types` is still passed so Node 22 and Node 24 share one command. Early Node 22 required the flag to execute TypeScript. On Node 24, and on the reported Node v26.13.1, type stripping is enabled by default and the flag is still accepted.

Windows PowerShell and cmd do not expand `*.test.ts`. The runner passes an explicit file list:

```powershell
node services/apex-executor/scripts/run-tests.mjs
node --experimental-strip-types services/apex-executor/scripts/mock-lifecycle.mjs
```

### Durability

`atomicWrite` fsyncs the temporary file before `rename` on every platform. On Linux and other POSIX hosts it then fsyncs the parent directory. Any error from that step throws. Health reports `durability` `full` and `directoryFsyncSupported` true.

On Windows, opening or fsyncing a directory is unsupported. That step tolerates only `EPERM`, `EISDIR`, `EBADF`, and `EINVAL`, and only when `process.platform === "win32"`. The same errors on POSIX still throw. Health and the process log report `durability` `file-only`, `directoryFsyncSupported` false, and a one-time warning. A crash can keep the renamed snapshot. A power loss can still lose the rename. That is not POSIX durability.

Corrupt snapshots, a failed temp write, a failed temp fsync, and a failed rename still throw on every platform.

POSIX mode `0600` on `/etc/apex-executor/secrets.env` is a Linux install requirement. Windows does not implement those mode bits. The suite does not treat a Windows ACL as a substitute, and it does not skip a Linux permission check: there is no mode-bit assertion to relax.

Lock ownership uses `process.kill(pid, 0)`. `ESRCH` is the only code treated as dead. `EPERM` means the pid exists but cannot be signaled, including on Windows, so the owner stays alive and the lock is not stolen.

`SIGTERM` and `SIGINT` stop the process on both platforms. Windows also handles `SIGBREAK`.

## Linux VM

Run one instance, as its own user, not on the research host.

```bash
sudo useradd --system --home /opt/apex-quant-x --shell /usr/sbin/nologin apex-executor || true
sudo mkdir -p /var/lib/apex-executor /etc/apex-executor /opt/apex-quant-x/releases
sudo chown -R apex-executor:apex-executor /var/lib/apex-executor /opt/apex-quant-x
sudo install -m 0600 -o apex-executor -g apex-executor services/apex-executor/deploy/apex-executor.env.example /etc/apex-executor/secrets.env
# edit /etc/apex-executor/secrets.env on the VM. Do not commit it.
sudo install -m 0644 services/apex-executor/deploy/apex-executor.service /etc/systemd/system/apex-executor.service
sudo systemctl daemon-reload
sudo systemctl enable --now apex-executor
sudo systemctl status apex-executor
```

Paper credentials belong in `/etc/apex-executor/secrets.env` or `/etc/apex-executor/paper.json` (mode `0600`, owner `apex-executor`):

```
APEX_EXECUTOR_HEALTH_TOKEN=replace-with-a-local-token
APEX_EXECUTOR_PAPER_KEY_ID=replace-with-paper-key-id
APEX_EXECUTOR_PAPER_SECRET=replace-with-paper-secret
APEX_OPERATOR_SECRET=replace-with-operator-secret
APEX_GATE_SECRET=replace-with-gate-secret
```

Do not set `APCA_LIVE_API_KEY_ID`, `APEX_EXECUTOR_LIVE_KEY_ID`, or `LIVE_APCA_API_KEY_ID` in this file. The process refuses to start in PAPER mode when those are present, and it does not load live secrets.

Health, on the VM only:

```bash
APEX_EXECUTOR_HEALTH_TOKEN=replace-with-a-local-token node /opt/apex-quant-x/services/apex-executor/deploy/healthcheck.mjs
```

The listener is `127.0.0.1:8787`. `POST /instructions` only ingests a signed proposal. It cannot submit.

`/health` is still the only status route, and it still requires `x-executor-token`. It now includes `brokerPoll`:

| Field | Meaning |
| --- | --- |
| `lastAttemptAt` | When this process last started a poll. |
| `lastSnapshotOkAt` | When account, clock, positions, open orders, and the quote all returned HTTP 200 and parsed. |
| `lastReconcileOkAt` | When outstanding journal orders matched the broker and no unknown broker order was present. |
| `lastFullSuccessAt` | When both of those happened. Snapshot success alone does not move this. |
| `lastFailureAt` / `lastFailureKind` | Latest failure. Kind is only `auth`, `network`, `timeout`, `http`, `parse`, or `reconcile`. |
| `consecutiveFailures` | Failed polls since the last full success. A full success resets it to 0. |
| `freshnessMs` | Age of this process's full success, or `null` if it has not had one. |
| `staleAfterMs` | Freshness window. Default is 5000. Values above 5000 are clamped to the existing 5s evidence limit, so a slower poll cannot extend execution authority. `APEX_EXECUTOR_STALE_AFTER_MS` can only make this stricter. |
| `stale` | True when this process has no full success inside that window. A timestamp left on disk by the previous process does not clear it. |
| `reconciliation.outcome` | `OK`, `MISMATCH`, `UNKNOWN_ORDERS`, `NOT_RUN`, or `FAILED`. |
| `reconciliation.outstandingOrders` | Journal orders that are not flat or closed. |
| `reconciliation.unknownOrders` | Open broker orders whose client id is not in the journal. They are counted, not marked flat. |

`ready` is true only when market evidence is inside the existing 5s window, `brokerPoll.stale` is false, and reconciliation is `OK`. `accept` and exit authorization use that same rule. A transport failure (auth, network, timeout, HTTP, parse) does not move `lastFullSuccessAt`; execution keeps using the last full success until it becomes stale. A snapshot that parses while reconciliation is `MISMATCH`, `UNKNOWN_ORDERS`, or `FAILED` refuses execution immediately, even if the previous full success is still young. `PROPOSED` and `SUBMISSION_ATTEMPTED` orders that the broker does not have are a mismatch. They stay `PROPOSED` or become `UNKNOWN`. They are never treated as flat.

A closed market is not a failed poll. The clock is still read. New buys keep the existing session and cutoff checks. The host clock is the freshness clock: a step backward is stale, and a step forward ages the evidence early.

The baseline poll interval is 3000ms (`APEX_EXECUTOR_POLL_INTERVAL_MS`). A successful poll schedules the next one at that baseline. A failure doubles the wait, starting from the baseline, and the wait stops growing at 30000ms. The next success returns the wait to the baseline. With a 3s interval, one missed poll backs off to 6s. The last good snapshot is then older than 5000ms before that retry runs, and the gate closes. That is intentional. Do not raise `staleAfterMs` to keep the gate open across a slower poll. Values above 5000 are clamped.

## Request budget

Each poll snapshot is 4 Trading API GETs on `paper-api.alpaca.markets`: account, clock, positions, and open orders. The SPY quote is a separate Market Data API GET on `data.alpaca.markets` (`/v2/stocks/SPY/quotes/latest?feed=iex`). It is not part of the Trading API count.

Each outstanding journal order then adds exactly 3 Trading API GETs: positions, open orders, and the order looked up by client id. Those position and open-order reads are not reused from the snapshot.

At the 3000ms baseline that is 20 polls a minute:

- 0 outstanding orders: 80 Trading API requests/min, plus 20 Market Data requests/min.
- 2 outstanding orders: 200 Trading API requests/min, plus 20 Market Data requests/min.

200 Trading API requests/min is Alpaca's standard limit. This configuration is not safe for an unlimited number of outstanding orders. Three outstanding orders are 260 Trading API requests/min before the quote. An HTTP 429 is failure kind `http`. It does not count as a full success, and the gate closes once the last full success is older than 5000ms.

The process now enforces a shared Trading API budget of 150 requests in a trailing 60 seconds, which is under that 200 limit. Ten of those requests are reserved for one submit, one cancel, and a recovery lookup. At a 3000ms poll the math is:

- polls per minute = 60000 / 3000 = 20
- room per poll after the reserve = (150 - 10) / 20 = 7
- a poll spends 4 snapshot GETs, leaving 3
- each in-flight order costs 3 GETs
- outstanding cap = floor((7 - 4) / 3) = 1

A poll, submit, cancel, or recovery lookup that would pass 150 is refused before the broker is called. The quote on `data.alpaca.markets` is still not part of this count. `staleAfterMs` stays capped at 5000. The cap is for in-flight orders (`submitted`, `accepted`, `partially_filled`, `UNKNOWN`). A filled position is not a second in-flight order, so the supervised exit can be the one working order after the buy fills. `requestBudget` on `/health` reports the limit, the window usage, the reserve, the cap, and the in-flight count. It does not include credentials.

## Safe deployment

The production VM was filled by copy. It does not have a confirmed git checkout. Do not run `git fetch`, `git checkout`, or `git rev-parse` on it. Build the release on a trusted workstation from the merged commit. `PAPER_POST_ENABLED`, `LIVE_POST_ENABLED`, and `strategyApproved` stay false. Do not put tokens or brokerage keys in a ticket.

Secrets stay in `/etc/apex-executor/secrets.env` and `/etc/apex-executor/paper.json`. The journal, state, lock, inbox, and fills stay in `/var/lib/apex-executor`. A deploy never reads or writes those directories. The systemd unit keeps `WorkingDirectory=/opt/apex-quant-x` and starts `services/apex-executor/src/main.ts` from that fixed path. The switch below replaces that directory with a release by rename. `releases/` is kept outside the directory being renamed so the new tree is not overwritten and the previous tree is kept.

On the workstation, from a clean checkout of the merged SHA:

```bash
SHA=<merged-sha>
rm -rf "/tmp/apex-release-$SHA"
mkdir -p "/tmp/apex-release-$SHA"
git archive "$SHA" | tar -x -C "/tmp/apex-release-$SHA"
printf '%s\n' "$SHA" > "/tmp/apex-release-$SHA/VERSION"
cd "/tmp/apex-release-$SHA"
npm ci
node services/apex-executor/scripts/run-tests.mjs
node services/apex-executor/scripts/typecheck.mjs
ssh user@vm "sudo mkdir -p /opt/apex-quant-x/releases/$SHA && sudo chown -R \$USER /opt/apex-quant-x/releases"
rsync -a --delete \
  --exclude .git \
  --exclude .env \
  --exclude '.env.*' \
  --exclude node_modules \
  --exclude services/apex-executor/data \
  --exclude '**/writer.lock' \
  "/tmp/apex-release-$SHA/" \
  "user@vm:/opt/apex-quant-x/releases/$SHA/"
```

That upload lands only in `releases/<sha>/`. It does not replace `/opt/apex-quant-x/services` or anything else the running process is using. `git archive` does not contain `.git`, `.env`, or `node_modules`. The excludes are still there so a later checkout-based upload cannot copy secrets, a local data directory, or a lock. Do not rsync `/etc/apex-executor` or `/var/lib/apex-executor`.

On the VM, install dependencies in the staged release, then switch the fixed path by rename. `npm ci --omit=dev` is enough to run the process. Typecheck needs the TypeScript package, which is a production dependency in this repo, so the same install can run the checks:

```bash
SHA=<merged-sha>
sudo chown -R apex-executor:apex-executor "/opt/apex-quant-x/releases/$SHA"
sudo -u apex-executor bash -lc "cd /opt/apex-quant-x/releases/$SHA && npm ci --omit=dev && node services/apex-executor/scripts/run-tests.mjs && node services/apex-executor/scripts/typecheck.mjs"
ts=$(date -u +%Y%m%dT%H%M%SZ)
sudo systemctl stop apex-executor
# Move the release store out of the live directory before the rename.
sudo mkdir -p /opt/apex-releases
if [ -d /opt/apex-quant-x/releases ]; then sudo mv /opt/apex-quant-x/releases /opt/apex-releases/releases; fi
sudo mv /opt/apex-quant-x "/opt/apex-releases/previous-$ts"
sudo mv "/opt/apex-releases/releases/$SHA" /opt/apex-quant-x
sudo mkdir -p /opt/apex-quant-x/releases
sudo mv /opt/apex-releases/releases/* /opt/apex-quant-x/releases/ || true
sudo mv "/opt/apex-releases/previous-$ts" "/opt/apex-quant-x/releases/previous-$ts"
sudo chown -R apex-executor:apex-executor /opt/apex-quant-x
sudo systemctl start apex-executor
```

Wait until `systemctl is-active apex-executor` is `active`, then one poll interval (default 3s; a few seconds more if the broker is slow). The authenticated check exits 0 only when the frozen gate is intact, `brokerPoll.stale` is false, and `reconciliation.outcome` is `OK`:

```bash
APEX_EXECUTOR_HEALTH_TOKEN=replace-with-a-local-token node /opt/apex-quant-x/services/apex-executor/deploy/healthcheck.mjs
```

The line it prints looks like `brokerPoll stale=false reconciliation=OK outstandingOrders=0 unknownOrders=0`. Confirm `VERSION` in `/opt/apex-quant-x` is the merged SHA.

Rollback uses the previous tree and does not touch `/var/lib/apex-executor`:

```bash
ts=<the previous timestamp>
sudo systemctl stop apex-executor
sudo mv /opt/apex-quant-x/releases /opt/apex-releases/releases
sudo mv /opt/apex-quant-x "/opt/apex-releases/failed-$ts"
sudo mv "/opt/apex-releases/releases/previous-$ts" /opt/apex-quant-x
sudo mkdir -p /opt/apex-quant-x/releases
sudo mv /opt/apex-releases/releases/* /opt/apex-quant-x/releases/ || true
sudo systemctl start apex-executor
```

If the process crashes, or `stale` stays true with `NOT_RUN` or `FAILED` after several intervals, roll back. `MISMATCH` or `UNKNOWN_ORDERS` means the gate sees a book that does not match the journal. Do not roll back to hide that. While POST is disabled, a journal `PROPOSED` order that was never sent mismatches until the operator reconciles it. The health check prints only those enums and counts.

## Supervised PAPER acceptance: SPY fractional buy-and-exit ($25 cap)

This SHA does not transmit. `REAL_BROKER_WRITE_ENABLED` is a constant false. The Alpaca adapter throws `PAPER POST DISABLED` before `fetch` on POST, PATCH, and DELETE. `PAPER_POST_ENABLED`, `LIVE_POST_ENABLED`, and `strategyApproved` stay false in code. Setting `PAPER_POST_ENABLED=true` in the environment does not by itself authorize a write, and it does not reach `fetch` until a separate reviewed PR removes that constant guard. LIVE stays disabled either way. A dev flag does not authorize a submit. `STRATEGY_TRADE` stays blocked while `strategyApproved` is false. A supervised test uses category `SUPERVISED_PAPER_TEST` and does not set or imply strategy approval.

A supervised order is not a limit ticket. `SUPERVISED_PAPER_TEST` buys are signed as `market_notional` and sells as `market_qty`. The operator HMAC and the Sigma/Sentinel gate HMAC both bind symbol, side, order type, the exact notional or qty string, `time_in_force`, `extended_hours`, expiry, and `client_order_id`. The POST body is those fields copied onto Alpaca's wire names (`type=market`, `notional` or `qty`, `time_in_force`, `extended_hours`, `client_order_id`). Nothing is reformatted. A limit ticket is refused instead of being turned into a market order. Existing limit signatures are unchanged.

Alpaca's notional field cannot be combined with `qty` and is a market order ([Create an Order](https://docs.alpaca.markets/us/reference/postorder)). The fractional guide sets a $1 minimum, at most 2 decimal places on notional, at most 9 on qty, and no fractional short ([Fractional Trading](https://docs.alpaca.markets/us/docs/fractional-trading)). Fills come from the order's `filled_qty`, `filled_avg_price`, and `status`, plus `GET /v2/account/activities/FILL` ([Account Activities](https://docs.alpaca.markets/us/docs/account-activities)). That FILL object has no fee. A missing fee stays unknown. It is not stored as 0. Injected evidence uses `evidenceChannel: "injected"` and `hermesPerformanceRefusal` rejects it.

A single 404 after a timeout is not absence. Recovery repeats GET by client order id (default 3, minimum 2, cap 5, backoff `APEX_EXECUTOR_ABSENCE_BACKOFF_MS`) and cross-checks `GET /v2/orders?status=open`, `GET /v2/orders?status=all`, and FILL activities. Absence requires every one of those reads to be a clean miss, with the order lists not truncated at 500. Anything less stays `UNKNOWN`, is journaled, survives restart, is listed on `/health` as `unknownClientOrderIds`, and blocks every new client order id. The uncertain id is not replaced. If the window ends without that evidence, the order stays `UNKNOWN` for the operator. See `src/absence.ts`.

The 10-request reserve can be spent only by a cancel, a recovery lookup, or a risk-reducing exit. Entries and polls stop at 140. Stale evidence refuses an order even when budget remains. Exit quantity, freshness, expiry, and budget are checked again after the position read and immediately before the write.

The order states are `intent`, `submitted`, `accepted`, `partially_filled`, `filled`, `rejected`, `canceled`, `expired`, and `UNKNOWN`. An illegal transition is journaled and refused. The intent line is fsynced before the injected writer is called. A timeout, a 5xx, or a 429 becomes `UNKNOWN` and is not retried. The next action is a GET by `client_order_id`. A found order is adopted. A 404 on an order that was sent is confirmed absence: that id is not posted again, and only a new operator approval can submit a new id. The round trip is complete only when a sell reconciles to `FLAT`: the broker position quantity for SPY is 0 and the open-order list has none for that order. An empty local book is not FLAT.

The kill switch blocks new buys and other position increases. It does not block a separately authorized exit. The exit still needs a fresh signature, Sigma approval, no Sentinel veto, fresh evidence under 5000ms, reconciliation `OK`, the writer lock, budget, and the oversell check.

Every step below is NO-GO unless it is true. Do not continue past a NO-GO.

1. **Separate write-path PR.** A different, small PR that enables the real PAPER write is reviewed on its own and merged. This lifecycle PR is not that PR. NO-GO if that diff does more than remove the constant guard, or if LIVE becomes reachable.
2. **Key rotation.** The owner rotates the PAPER key. The old leaked key is not reused. The new key is installed only in `/etc/apex-executor/secrets.env` or `/etc/apex-executor/paper.json` on the VM, mode `0600`, owner `apex-executor`. It is not committed, not logged, and not placed in a research tree. NO-GO if a LIVE key is present. The process still refuses to start in PAPER mode when a LIVE key is set.
3. **Versioned deploy.** From a clean checkout of the merged SHA, follow the rsync steps in "Safe deployment" above, including `VERSION` and the rollback tree. NO-GO if the deploy touches `/var/lib/apex-executor` or `/etc/apex-executor`.
4. **Health.** After the process is active, the authenticated health check is green: `brokerPoll.stale` is false, `reconciliation.outcome` is `OK`, outstanding and unknown counts are 0, the book is flat, and `requestBudget` is inside the cap. NO-GO on `MISMATCH`, `UNKNOWN_ORDERS`, `FAILED`, or a stale poll. Do not roll back just to hide a mismatch.
5. **Window.** During regular hours, confirmed by the broker clock (`is_open` true), the owner sets `PAPER_POST_ENABLED=true` for this window only and restarts the process. NO-GO outside regular hours, or if the constant guard from step 1 is not the one that was reviewed.
6. **One buy.** The operator signs one `SUPERVISED_PAPER_TEST` instruction for a SPY notional buy of at most $25. Sigma has approved and Sentinel has not vetoed. The executor journals the intent, then the broker GET shows the order and the fill. Hermes records the broker order id, fill id, qty, price, time, and provenance. A fee that is present and numerically 0 is a known zero. A payload with no fee keeps `feeKnown: false`, which means the fill is recognized for position, lifecycle, and FLAT, and net profit is not attributable. That fill never qualifies a strategy. A mock row is not evidence. NO-GO if any gate is missing, if a second order is working, or if the notional is above $25.
7. **Exit.** A separate signed sell, for the full broker-confirmed quantity, is authorized and submitted. NO-GO if the sell is larger than the position minus pending sells, if it is unsigned, or if the kill switch is being used as a substitute for that signature. The kill switch may be on; the exit gates still apply.
8. **Flat.** A broker positions GET shows quantity 0 for SPY and the open-order list has no order for the symbol. Reconciliation is `OK`. The sell record is `FLAT`. NO-GO if flat is inferred only from the local journal.
9. **Close the window.** Set `PAPER_POST_ENABLED=false`, restart, and confirm health still shows paper post disabled. LIVE remains disabled.
10. **Archive.** Keep the journal excerpt, the health JSON, and the Alpaca order ids. Do not copy secrets into that archive.

## Enablement build: first supervised SPY buy-and-exit

This branch is the proposed PAPER enablement. It is a draft and is not a merge. `LIVE_POST_ENABLED` and `strategyApproved` stay false. `supervisedActivation` on `/health` starts `closed`. A dev flag does not open it. The disabled adapter still throws `PAPER POST DISABLED` before `fetch`. The production process (`src/main.ts`) is the only path that can reach the PAPER host, and only while both of these are true: `PAPER_POST_ENABLED=true`, and an operator-signed activation window of at most 15 minutes. A restart drops the window. After `expiresAt`, new entries stop without another step.

If a position or a partially filled order is still open when the window ends, that is an emergency. No new entry is accepted: the nonce is not consumed and no intent is journaled. Recovery lookups continue. Cancel of a working order continues, and it still needs fresh evidence and reconciliation `OK`. Cancel does not treat `partially_filled` as a finished cancel. It keeps reading until the broker reports `canceled`, `filled`, `expired`, or `rejected`, or it leaves the order `UNKNOWN`. A risk-reducing exit does not need a new activation window. It does need a new operator-signed `market_qty` ticket, a current gate proof, fresh evidence, reconciliation `OK`, and a quantity no larger than the broker position minus pending sells. The signature, the gate, and the reconciliation are not skipped.

Startup runs recovery before the process accepts an instruction. One write is in flight at a time, under the writer lock. A POST that times out becomes `UNKNOWN` and is not sent again. Cancel is `DELETE /v2/orders/{id}` followed by GET until the broker reports `canceled`, `filled`, or `partially_filled`. The executor does not invent `filled_qty: 0`. FILL pages use `page_size`, `page_token`, and `direction`. A short page ends the read. A full page that is not followed by a short page is not absence.

GO only when every line below is true. Stop at the first NO-GO.

1. **Review this draft.** The diff is the production wiring, not a strategy change. NO-GO if LIVE is reachable or `strategyApproved` can become true.
2. **Rotate the PAPER key.** Do not reuse the leaked key. Install the new key only on the VM, mode `0600`. NO-GO if a LIVE key is present.
3. **Deploy this SHA** with the versioned rsync and the rollback tree above. Leave `PAPER_POST_ENABLED` unset. NO-GO if the deploy writes `/var/lib/apex-executor` or `/etc/apex-executor`.
4. **Health before the window.** Authenticated `/health`: `stale` false, `reconciliation.outcome` `OK`, `unknown` 0, `supervisedActivation` `closed`, `strategyApproved` false, `livePost` `DISABLED`. NO-GO on `MISMATCH`, `UNKNOWN_ORDERS`, or a stale poll.
5. **Open a short window during regular hours.** The broker clock `is_open` is true. Set `PAPER_POST_ENABLED=true` and restart. Post `/activation` with an operator HMAC over `PAPER_ACTIVATION`, the start, and the end. The end is at most 15 minutes after the start. `/health` then shows `supervisedActivation` `open` and `activationExpiresAt`. NO-GO if a dev flag was the only change, or if the clock is closed.
6. **Sign the buy.** One `market_notional` SPY buy, notional string at most `25.00`, `time_in_force` `day`, `extended_hours` false. Operator HMAC and Sigma/Sentinel HMAC cover those fields plus `client_order_id` and expiry. Post it to `/instructions`. Check the journal intent, then the broker GET by that client order id, then `/health`. Hermes has an operational fill: order id, activity id, qty, price, time, provenance. `feeKnown: false` means net profit is not attributable. The row does not qualify a strategy. NO-GO above $25, on a second working order, or if the POST body is not the signed fields.
7. **Sign the exit.** A separate `market_qty` sell for the broker-confirmed remaining quantity, linked to the filled buy. Same checks. NO-GO if the qty exceeds the position minus pending sells.
8. **Flat.** Positions GET qty 0 for SPY, open orders empty, reconciliation `OK`, both records `FLAT`. NO-GO if flat is only the local journal.
9. **Deactivate.** Let the window expire or restart the process. Set `PAPER_POST_ENABLED=false` and restart again. `/health` shows `supervisedActivation` `closed`. LIVE stays disabled.
10. **Rollback.** If health is stale, the process crashes, or a write happens outside the window, stop the service and restore the previous tree with the commands above. Do not roll back to hide `UNKNOWN` or `MISMATCH`.
11. **Archive.** Journal excerpt, `/health` JSON from before, during, and after, and the Alpaca order ids. No secrets in the archive.

## Invariants

- One writer lock. A live pid is never replaced. `EPERM` from `process.kill(pid, 0)` counts as alive. A dead pid can be recovered only after that pid is provably gone.
- Snapshot durability is `full` on Linux (file fsync, rename, directory fsync). On Windows it is `file-only`. Production stays the Linux VM.
- Unknown broker lookups are not treated as flat, and they are not resubmitted. An open broker order that is not in the journal is `UNKNOWN_ORDERS` and does not become a flat record.
- `ready` requires a full broker poll in this process. Restart is stale until that poll reconciles. Snapshot success without reconciliation does not advance `lastFullSuccessAt`.
- Exits use a separate signed sell ticket and the broker's position quantity.
- Hermes receives the outcome notes. Pilot reads that telemetry. Neither can approve a trade.
