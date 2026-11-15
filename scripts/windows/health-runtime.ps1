$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path (Join-Path $Root "package.json"))) { $Root = "C:\Users\sharm\apex-quant-x-github" }
$Hb = Join-Path $Root "research\lab\paper-runtime-heartbeat.json"
if (-not (Test-Path $Hb)) { Write-Output "NO_HEARTBEAT root=$Root"; exit 1 }
$j = Get-Content $Hb -Raw | ConvertFrom-Json
$heartbeat = [datetimeoffset]::Parse($j.heartbeat, [cultureinfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::RoundtripKind)
$age = ([datetimeoffset]::UtcNow - $heartbeat).TotalSeconds
$pidAlive = $false
if ($j.pid) { $pidAlive = [bool](Get-Process -Id $j.pid -ErrorAction SilentlyContinue) }
Write-Output ("status=" + $j.status)
Write-Output ("heartbeat=" + $j.heartbeat)
Write-Output ("age_seconds=" + [math]::Round($age,1))
Write-Output ("pid=" + $j.pid)
Write-Output ("pid_alive=" + $pidAlive)
Write-Output ("signal=" + $j.signal)
Write-Output ("brokerWrites=" + $j.brokerWrites)
Write-Output ("brokerError=" + $j.brokerError)
Write-Output ("root=" + $Root)
if ($age -lt -5) { Write-Output "FUTURE_HEARTBEAT"; exit 2 }
if ($age -gt 90 -or -not $pidAlive -or $j.brokerError) { exit 2 }
