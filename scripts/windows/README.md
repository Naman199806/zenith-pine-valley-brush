# Windows manual runtime

RAV Endpoint Protection flagged the Task Scheduler installers. Those files were removed. Do not recreate them, rename them, or encode them.

There is no automatic startup and no persistence. Run the runtime in an open PowerShell window. Closing the window stops it.

Flags stay off:
- LIVE=false
- PAPER_AUTO=false
- strategyApproved=false
- broker writes disabled

```powershell
cd C:\Users\sharm\apex-quant-x-github
git fetch origin
git stash push -u -m "asus-local"
git merge --ff-only origin/main
node --experimental-strip-types --test src/lib/apex/runtime/defects.test.ts
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\start-runtime.ps1
```

In a second window:

```powershell
cd C:\Users\sharm\apex-quant-x-github
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\health-runtime.ps1
```

Stop by closing the runtime window, or:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\stop-runtime.ps1
```

The older paper-pilot Task Scheduler installer is obsolete and has been removed. `start-pilot.ps1` remains only as a manual script and does not install persistence.
