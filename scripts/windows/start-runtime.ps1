$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path (Join-Path $Root "package.json"))) { $Root = "C:\Users\sharm\apex-quant-x-github" }
Set-Location $Root
$Lock = Join-Path $Root "research\lab\windows\runtime.lock"
if (Test-Path $Lock) {
  try {
    $j = Get-Content $Lock -Raw | ConvertFrom-Json
    if ($j.pid -and (Get-Process -Id $j.pid -ErrorAction SilentlyContinue)) {
      Write-Output "already running pid $($j.pid)"
      exit 0
    }
  } catch {
    Write-Output "stale lock; Node will recover it"
  }
}
Write-Output "DISABLED READ-ONLY runtime. No automatic startup. Close this window to stop it."
Write-Output "LIVE=false PAPER_AUTO=false strategyApproved=false brokerWrites=0"
node --experimental-strip-types scripts/paper-runtime.mjs
exit $LASTEXITCODE
