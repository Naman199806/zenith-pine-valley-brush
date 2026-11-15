$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path (Join-Path $Root "package.json"))) { $Root = "C:\Users\sharm\apex-quant-x-github" }
$Task = "ApexQuantX-PaperRuntime"
$Start = Join-Path $Root "scripts\windows\start-runtime.ps1"
$Action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$Start`"" -WorkingDirectory $Root
$Trigger = New-ScheduledTaskTrigger -AtStartup
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Hours 0)
Register-ScheduledTask -TaskName $Task -Action $Action -Trigger $Trigger -Settings $Settings -User $env:USERNAME -RunLevel Limited -Force | Out-Null
Write-Output "installed $Task root=$Root supervised=foreground RestartCount=3"
