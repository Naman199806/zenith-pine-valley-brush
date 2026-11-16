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
node --experimental-strip-types services/apex-executor/scripts/mock-lifecycle.mjs
```

## Windows tests

From the clone (this checkout is `C:\Users\sharm\apex-quant-x-clean` when that is the local path):

```powershell
cd C:\Users\sharm\apex-quant-x-clean
node --experimental-strip-types --test services/apex-executor/test/*.test.ts
node --experimental-strip-types services/apex-executor/scripts/mock-lifecycle.mjs
```

The mock script prints `realFill: false`. Do not treat that output as a fill.

## Linux VM

Run one instance, as its own user, not on the research host.

```bash
sudo useradd --system --home /opt/apex-quant-x --shell /usr/sbin/nologin apex-executor || true
sudo mkdir -p /var/lib/apex-executor /etc/apex-executor /opt/apex-quant-x
sudo rsync -a --exclude .git --exclude node_modules ./ /opt/apex-quant-x/
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

Copy from Windows:

```powershell
cd C:\Users\sharm\apex-quant-x-clean
scp -r .\services .\scripts .\src .\package.json .\package-lock.json user@vm:/tmp/apex-quant-x/
ssh user@vm "sudo rsync -a /tmp/apex-quant-x/ /opt/apex-quant-x/ && sudo systemctl restart apex-executor"
```

## Invariants

- One writer lock. A live pid is never replaced. A dead pid can be recovered.
- Unknown broker lookups are not treated as flat, and they are not resubmitted.
- Exits use a separate signed sell ticket and the broker's position quantity.
- Hermes receives the outcome notes. Pilot reads that telemetry. Neither can approve a trade.
