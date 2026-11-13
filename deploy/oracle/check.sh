#!/bin/sh
set -eu
missing=0
for f in deploy/oracle/Dockerfile deploy/oracle/compose.yaml package.json; do
  if [ ! -f "$f" ]; then
    echo "missing $f"
    missing=1
  fi
done
if [ "$(uname -m)" != "aarch64" ]; then
  echo "ARM64 UNVERIFIED on $(uname -m)"
  missing=1
fi
echo "PAPER_AUTO=false"
echo "LIVE=false"
exit "$missing"
