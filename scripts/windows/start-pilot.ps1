$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path (Join-Path $Root "package.json"))) { $Root = "C:\Users\sharm\apex-quant-x" }
Set-Location $Root
$LogDir = Join-Path $Root "research\lab\windows"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$Lock = Join-Path $LogDir "pilot.lock"
if (Test-Path $Lock) {
  $old = Get-Content $Lock -ErrorAction SilentlyContinue
  if ($old -and (Get-Process -Id $old -ErrorAction SilentlyContinue)) { Write-Output "already running pid $old"; exit 0 }
}
$envFile = Join-Path $Root ".env"
if (-not (Test-Path $envFile)) { throw "Missing .env with APCA_API_KEY_ID and APCA_API_SECRET_KEY" }
$proc = Start-Process -FilePath "node" -ArgumentList "--experimental-strip-types","scripts/paper-pilot-watchdog.mjs" -WorkingDirectory $Root -WindowStyle Hidden -RedirectStandardOutput (Join-Path $LogDir "pilot.out.log") -RedirectStandardError (Join-Path $LogDir "pilot.err.log") -PassThru
Set-Content -Path $Lock -Value $proc.Id
Write-Output "started pid $($proc.Id)"
