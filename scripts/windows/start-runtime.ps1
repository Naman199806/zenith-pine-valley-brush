$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path (Join-Path $Root "package.json"))) { $Root = "C:\Users\sharm\apex-quant-x-github" }
Set-Location $Root
$LogDir = Join-Path $Root "research\lab\windows"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$Lock = Join-Path $LogDir "runtime.lock"
if (Test-Path $Lock) {
  try {
    $j = Get-Content $Lock -Raw | ConvertFrom-Json
    if ($j.pid -and (Get-Process -Id $j.pid -ErrorAction SilentlyContinue)) {
      Write-Output "already running pid $($j.pid)"
      exit 0
    }
  } catch {
    Write-Output "stale or unreadable lock; Node will recover it"
  }
}
$Node = (Get-Command node -ErrorAction Stop).Source
if ($args -contains "-Background") {
  $proc = Start-Process -FilePath $Node -ArgumentList "--experimental-strip-types","scripts/paper-runtime.mjs" -WorkingDirectory $Root -WindowStyle Hidden -RedirectStandardOutput (Join-Path $LogDir "runtime.out.log") -RedirectStandardError (Join-Path $LogDir "runtime.err.log") -PassThru
  Write-Output "started disabled runtime pid $($proc.Id); Node owns the lock"
  exit 0
}
& $Node --experimental-strip-types scripts/paper-runtime.mjs
exit $LASTEXITCODE
