$ErrorActionPreference = "Stop"
$Root = "C:\Users\sharm\apex-quant-x"
$LogDir = Join-Path $Root "research\lab\windows"
$Lock = Join-Path $LogDir "pilot.lock"
$Kill = Join-Path $LogDir "KILL"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
Set-Content -Path $Kill -Value (Get-Date).ToUniversalTime().ToString("o")
if (Test-Path $Lock) {
  $old = Get-Content $Lock -ErrorAction SilentlyContinue
  if ($old) { Stop-Process -Id $old -Force -ErrorAction SilentlyContinue }
  Remove-Item $Lock -Force -ErrorAction SilentlyContinue
}
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like "*paper-pilot-watchdog.mjs*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Write-Output "pilot stopped"
