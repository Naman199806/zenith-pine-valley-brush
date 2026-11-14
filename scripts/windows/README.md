# Windows paper pilot

Grok Build cannot access this PC. Run these commands on Windows.

Copy these updated files into C:\Users\sharm\apex-quant-x first:
- scripts/paper-pilot-watchdog.mjs
- scripts/windows/*.ps1
- src/lib/apex/research/fmz-bb-rsi.ts
- src/lib/apex/research/pilot-ledger.ts
- research/lab/paper-pilot-auth.json

Then:

```powershell
cd C:\Users\sharm\apex-quant-x
node --experimental-strip-types --test src/lib/apex/research/fmz-bb-rsi.test.ts
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\install-task.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\start-pilot.ps1
Start-Sleep -Seconds 5
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\health.ps1
```

Stop:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\sharm\apex-quant-x\scripts\windows\stop-pilot.ps1
```

Keep the PC plugged in and set sleep to Never while the pilot is active.

Authorization is unchanged:
activated_at_utc 2026-11-14T03:05:00Z
expires_at_utc 2026-11-15T03:05:00Z
Automated entries stay disabled until this host is verified.
