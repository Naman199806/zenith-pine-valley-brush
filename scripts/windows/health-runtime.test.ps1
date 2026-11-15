$ErrorActionPreference = "Stop"
function AgeSeconds([string]$iso, [datetimeoffset]$now) {
  $heartbeat = [datetimeoffset]::Parse($iso, [cultureinfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::RoundtripKind)
  return ($now - $heartbeat).TotalSeconds
}
$now = [datetimeoffset]::Parse("2026-11-15T06:30:18.000Z")
$age = AgeSeconds "2026-11-15T06:30:00.000Z" $now
if ([math]::Abs($age - 18) -gt 0.001) { throw "expected 18 seconds, got $age" }
$future = AgeSeconds "2026-11-15T06:31:00.000Z" $now
if ($future -ge -5) { throw "future timestamp was not rejected: $future" }
Write-Output "health age regression PASS age=$age future=$future"
