# IR-02 operator evaluation. Read-only. No orders. No strategy approval.
$ErrorActionPreference = "Stop"
$Python = "C:\Users\sharm\openbb-research.venv\Scripts\python.exe"
$Root = "C:\Users\sharm\apex-quant-x-latest"
$Archive = Join-Path $Root "research\data\raw\alpaca-sip"
$Calendar = Join-Path $Root "research\lab\ir02-oops\exchange-calendar.json"
$Out = Join-Path $Root "research\lab\ir02-oops\evaluation-report.json"

Set-Location $Root
Write-Host "1. Archive inventory"
Get-ChildItem $Archive -Recurse -Filter *.json | Select-Object FullName, Length, LastWriteTime

Write-Host "2. Independent exchange calendar"
if (-not (Test-Path $Calendar)) { throw "Missing independent exchange calendar" }
$cal = Get-Content $Calendar -Raw | ConvertFrom-Json
if ($cal.source -ne "alpaca-paper-calendar") { throw "Calendar was not independently persisted" }

Write-Host "3. Completeness and checksum audit"
& $Python scripts\alpaca_sip_acquire.py --audit

Write-Host "4. Historical evaluation"
& $Python scripts\oops_eval.py | Tee-Object -FilePath $Out
Write-Host "Report written to $Out"
Write-Host "Missing sessions are coverage gaps, not no-trade evidence."
Write-Host "Short results are hypothetical. Long-only fractional results are the executable path."
Write-Host "strategyApproved remains false. Full archive is not claimed."
