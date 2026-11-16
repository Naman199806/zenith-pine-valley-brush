# Apex Executor

Independent execution runtime. Apex Quant X proposes. This service is the only process that may submit, and submission is hard-disabled.

## Startup

Health token comes from `/etc/apex-executor/secrets.env`, not from the unit file.

```powershell
cd C:\Users\sharm\apex-quant-x-clean
$env:APEX_EXECUTOR_MODE = "PAPER"
$env:APEX_EXECUTOR_HEALTH_TOKEN = "<local token>"
node --experimental-strip-types services/apex-executor/src/main.ts
```

POST is hard-disabled. Accepting an instruction marks it `PROPOSED`, not transmitted.
Operator proofs use the versioned payload in `src/approval.ts`, shared with `scripts/operator-sign-ticket.mjs`.
The health token and operator secret come from the environment or `/etc/apex-executor/secrets.env`. They are not logged.

## Invariants

- PAPER is the default. LIVE credentials are refused in PAPER mode.
- `POST_ENABLED` is hard-false. A single environment variable cannot enable it.
- Research cannot mint operator approval.
- Unknown submissions are reconciled by client order ID. They are not retried.
- Kill switch blocks new entries and still allows an authorized exit.

## VM

See `deploy/apex-executor.service`. Run one instance per account.
