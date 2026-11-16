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

Copy from Windows (example clone `C:\Users\sharm\apex-quant-x-clean`; any clone root works):

```powershell
cd C:\Users\sharm\apex-quant-x-clean
scp -r .\services .\scripts .\src .\package.json .\package-lock.json user@vm:/tmp/apex-quant-x/
ssh user@vm "sudo rsync -a /tmp/apex-quant-x/ /opt/apex-quant-x/ && sudo systemctl restart apex-executor"
```

## Invariants

- One writer lock. A live pid is never replaced. `EPERM` from `process.kill(pid, 0)` counts as alive. A dead pid can be recovered only after that pid is provably gone.
- Snapshot durability is `full` on Linux (file fsync, rename, directory fsync). On Windows it is `file-only`. Production stays the Linux VM.
- Unknown broker lookups are not treated as flat, and they are not resubmitted.
- Exits use a separate signed sell ticket and the broker's position quantity.
- Hermes receives the outcome notes. Pilot reads that telemetry. Neither can approve a trade.
