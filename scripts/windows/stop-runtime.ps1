$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path (Join-Path $Root "package.json"))) { $Root = "C:\Users\sharm\apex-quant-x-github" }
$Lock = Join-Path $Root "research\lab\windows\runtime.lock"
if (Test-Path $Lock) {
  $old = Get-Content $Lock -ErrorAction SilentlyContinue
  if ($old) { Stop-Process -Id $old -Force -ErrorAction SilentlyContinue }
  Remove-Item $Lock -Force -ErrorAction SilentlyContinue
}
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like "*paper-runtime.mjs*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Write-Output "runtime stopped"
