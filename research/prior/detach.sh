#!/usr/bin/env bash
# Run a command in its own Linux session so it survives the Windows launcher (wsl.exe) being stopped, then wait for
# it so Task Scheduler still sees the run as active. Usage: scripts/detach.sh <command> [args...]
set -uo pipefail
setsid nohup "$@" </dev/null >/dev/null 2>&1 &
pid=$!
while kill -0 "$pid" 2>/dev/null; do sleep 20; done
