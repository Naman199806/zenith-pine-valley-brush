# Restore Apex Quant X

SHA-256 is printed after the archive is built. Check it before extracting.

## Install

```
tar -xzf apex-recovery-full.tar.gz -C /some/empty/dir
cd /some/empty/dir
npm ci
```

`node_modules` is not in the archive. `npm ci` uses `package-lock.json`.

## Test and build

```
npm test
npx tsc --noEmit
npm run build
```

## Freqtrade state

The closed BTC dry-run trade is in `.runtimes/freqtrade-run/state/dryrun.sqlite`.
Strategy is `.runtimes/freqtrade-run/user_data/strategies/ApexDry.py`.
Config is `.runtimes/freqtrade-run/config.json` with `dry_run: true`.

Freqtrade itself is not in this archive. The sandbox used Freqtrade 2026.10 on Python 3.12.15. Install that separately if you want to resume the dry-run. Do not point it at Alpaca.

## Keys

Paper credentials are not in this archive. Add them only on a host you control. Do not enable PAPER_AUTO. Do not enable live trading.

## Not included

- `node_modules`
- `.grok/` (contains paper keys)
- Freqtrade, LEAN, and Hermes runtimes
- Full Coinbase candle series. Coverage files are in `research/lab/`. The 987-bar series was fetched live and not stored as a raw file.

Archive: artifacts/apex-recovery-full-20261112T235749Z.tar.gz
SHA-256: 98641f258b8753a9ab503fffb0381aa87c8dc58c7b456d3108d1f5fe2c7a32e1
