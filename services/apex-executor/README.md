# Apex Executor

Bot 2 execution service for Apex Quant X. Research still proposes. This process is the only one that may submit, and submission to Alpaca is disabled.

Current gate, enforced in code:

- mode `PAPER_READ_ONLY`
- PAPER POST `DISABLED`
- LIVE POST `DISABLED`
- autonomous strategy trading `DISABLED`
- `strategyApproved=false`

The executor does not generate a side, does not override Sigma or Sentinel, and does not mint operator authorization. A paper exercise cannot turn LIVE on.

## What it does

1. Checks the operator signature, the Sigma/Sentinel proof, expiry, and nonce.
2. Reads account, positions, open orders, and the quote through the existing paper client before it will accept an instruction.
3. Applies size, duplicate, position, session, halt, and kill-switch limits.
4. Journals every decision in an append-only file and reports the outcome through Hermes.
5. On restart, replays the journal and reconciles by `client_order_id` before it accepts anything new. An uncertain submit is not retried.

Exits and stops are accepted only when they refer to a position this service already authorized. They are not new directional signals.

## Run

From the repository root, with Node 22:

```bash
cp services/apex-executor/deploy/apex-executor.env.example /etc/apex-executor.env
# edit the copy locally; do not commit it
node --experimental-strip-types services/apex-executor/src/main.ts
```

Health, on the same machine:

```bash
APEX_EXECUTOR_HEALTH_TOKEN=replace-with-a-local-token node services/apex-executor/deploy/healthcheck.mjs
```

The listener is `127.0.0.1:8787`. `GET /health` and `POST /instructions` require the header `x-executor-token`. There is no HTTP route that submits an order.

Paper credentials are `APEX_EXECUTOR_PAPER_KEY_ID` and `APEX_EXECUTOR_PAPER_SECRET`, or a JSON file at `APEX_EXECUTOR_PAPER_SECRETS_FILE` with `keyId` and `secret`. Live variables are refused unless `APEX_EXECUTOR_MODE=LIVE` and `APEX_EXECUTOR_ENABLE_LIVE=I_ENABLE_LIVE` are both set, and even then this build does not load them.

## Deploy

One instance per account, on a Linux VM that does not host the research agents:

```bash
sudo useradd --system --home /opt/apex-quant-x --shell /usr/sbin/nologin apex-executor || true
sudo mkdir -p /var/lib/apex-executor /etc/apex-executor
sudo cp services/apex-executor/deploy/apex-executor.env.example /etc/apex-executor.env
sudo cp services/apex-executor/deploy/apex-executor.service /etc/systemd/system/apex-executor.service
# put the paper JSON at /etc/apex-executor/paper.json, mode 0600, owner apex-executor
sudo systemctl daemon-reload
sudo systemctl enable --now apex-executor
sudo systemctl status apex-executor
```

Add `User=apex-executor` to the unit once that account exists. Keep `/etc/apex-executor.env` out of git. Do not point the research process at `APEX_EXECUTOR_PAPER_*` or any live key.

## Tests

```bash
node --experimental-strip-types --test services/apex-executor/test/*.test.ts
```

Broker calls in those tests are mocks. A read-only Alpaca paper check runs only when `APEX_EXECUTOR_PAPER_KEY_ID` and `APEX_EXECUTOR_PAPER_SECRET` are already in the environment. Otherwise that test is skipped.

## Authorization

Operator signatures are verified by `src/lib/apex/broker/paper-equity-transport.ts`. The minting tool is `scripts/operator-sign-ticket.mjs`, which this service does not call. Sigma and Sentinel proofs are verified by `verifyGateProof` in `src/lib/apex/live/executor.ts`. Outcomes are written with `HermesJournal`.
