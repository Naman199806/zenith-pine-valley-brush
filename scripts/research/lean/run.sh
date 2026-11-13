#!/bin/sh
# Run the pinned LEAN launcher. Records the process id. No brokerage credentials.
set -eu
ROOT=/workspace/.runtimes/lean-run
export DOTNET_ROOT=/workspace/.runtimes/dotnet
export PATH="$DOTNET_ROOT:$PATH"
export DOTNET_CLI_HOME=/workspace/.runtimes/dotnet-home
export DOTNET_CLI_TELEMETRY_OPTOUT=1
export NUGET_PACKAGES=/workspace/.runtimes/nuget
cd "$ROOT"
dotnet /workspace/.runtimes/src/Lean/Launcher/bin/Release/QuantConnect.Lean.Launcher.dll \
  --config /workspace/.runtimes/src/Lean/Launcher/config.json \
  --environment backtesting \
  --algorithm-type-name ApexFixtureAlgorithm \
  --algorithm-language CSharp \
  --algorithm-location /workspace/.runtimes/lean-run/build/ApexFixtureAlgorithm.dll \
  --data-folder /workspace/.runtimes/lean-run/Data \
  --results-destination-folder /workspace/.runtimes/lean-run/results \
  --close-automatically true \
  --backtest-name apex-fixture > "$ROOT/launcher.log" 2>&1 &
pid=$!
echo "$pid" > "$ROOT/launcher.pid"
wait "$pid"
code=$?
echo "$code" > "$ROOT/launcher.exit"
exit "$code"
