$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path (Join-Path $Root "package.json"))) { $Root = "C:\Users\sharm\apex-quant-x-github" }
Set-Location $Root
$LogDir = Join-Path $Root "research\lab\windows"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$Lock = Join-Path $LogDir "runtime.lock"
if (Test-Path $Lock) {
  $old = Get-Content $Lock -ErrorAction SilentlyContinue
  if ($old -and (Get-Process -Id $old -ErrorAction SilentlyContinue)) { Write-Output "already running pid $old"; exit 0 }
}
$proc = Start-Process -FilePath "node" -ArgumentList "--experimental-strip-types","scripts/paper-runtime.mjs" -WorkingDirectory $Root -WindowStyle Hidden -RedirectStandardOutput (Join-Path $LogDir "runtime.out.log") -RedirectStandardError (Join-Path $LogDir "runtime.err.log") -PassThru
Set-Content -Path $Lock -Value $proc.Id
Write-Output "started disabled runtime pid $($proc.Id)"
