$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path (Join-Path $Root "package.json"))) { $Root = "C:\Users\sharm\apex-quant-x-github" }
$Hb = Join-Path $Root "research\lab\paper-pilot-heartbeat.json"
$Lock = Join-Path $Root "research\lab\windows\pilot.lock"
if (-not (Test-Path $Hb)) { Write-Output "NO_HEARTBEAT root=$Root"; exit 1 }
$j = Get-Content $Hb -Raw | ConvertFrom-Json
$age = ((Get-Date).ToUniversalTime() - [datetime]$j.heartbeat).TotalSeconds
Write-Output ("status=" + $j.status)
Write-Output ("heartbeat=" + $j.heartbeat)
Write-Output ("age_seconds=" + [math]::Round($age,1))
Write-Output ("signal=" + $j.signal)
Write-Output ("entries=" + $j.entries)
Write-Output ("btc=" + $j.btcQty)
Write-Output ("root=" + $Root)
Write-Output ("lock=" + $(if (Test-Path $Lock) { Get-Content $Lock } else { "none" }))
if ($age -gt 180) { exit 2 }
