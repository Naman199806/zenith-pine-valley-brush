# Apex on an ASUS Windows PC

This has not been deployed. These are instructions only.

## Requirements

- Windows 11
- WSL2 with Ubuntu 24.04
- Node v22 and npm 10
- Python 3.12 if you want Freqtrade 2026.10
- 8 GB free disk, 4 GB RAM

## Install

```
wsl
cd ~
tar -xzf apex-recovery-full-*.tar.gz
cd apex
npm ci
```

## Data

Keep the SQLite snapshot on a real disk, not /tmp:

```
mkdir -p ~/apex-state
cp research/lab/state/dryrun-snapshot.sqlite ~/apex-state/
```

## Start and stop

```
npm run dev
# stop with Ctrl-C
```

Freqtrade is separate. Install 2026.10 into a venv. Do not give it exchange keys. dry_run stays true.

## Backup

Copy ~/apex-state and the research folder to a disk that is not this PC.

## Not done

No ASUS machine has run this. PAPER_AUTO stays false. Live stays off.
