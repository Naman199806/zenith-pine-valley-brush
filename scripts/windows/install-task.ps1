$ErrorActionPreference = "Stop"
$Root = "C:\Users\sharm\apex-quant-x"
$Task = "ApexQuantX-PaperPilot"
$Start = Join-Path $Root "scripts\windows\start-pilot.ps1"
$Action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$Start`""
$Trigger = New-ScheduledTaskTrigger -AtStartup
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Hours 0)
Register-ScheduledTask -TaskName $Task -Action $Action -Trigger $Trigger -Settings $Settings -User $env:USERNAME -RunLevel Limited -Force | Out-Null
Write-Output "installed $Task"
