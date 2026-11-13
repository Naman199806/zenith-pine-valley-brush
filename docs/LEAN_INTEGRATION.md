# LEAN integration

Status: **TESTED sidecar, not INTEGRATED**. The TypeScript 3-bar fixture is still not a LEAN run.

The pinned launcher was executed with `environment=backtesting` on a four-bar synthetic custom file. It is not a market backtest and it did not call Alpaca.

| Field | Value |
| --- | --- |
| Pin | `655ac6d475ad8539ff54583a26327e63b59c5703` |
| SDK | .NET 10.0.404 at `.runtimes/dotnet` |
| Launcher | `.runtimes/src/Lean/Launcher/bin/Release/QuantConnect.Lean.Launcher.dll` |
| Algorithm | `ApexFixtureAlgorithm` in `scripts/research/lean` |
| Dataset | `.runtimes/lean-run/Data/custom/apexfixture/fixture.csv` (synthetic) |
| Result | 2 simulated fills, buy 100 at 100.50, sell 100 at 101.00, fees 0, net 50, end equity 100050 |
| Broker | `brokerOrders: false`. Backtesting transaction handler only. |

The 50 dollar result is LEAN filling at the custom bar's close. The Apex fixture identity remains 1980 cents with next-bar-open fills and 10 bp costs. Those are different rules. Do not mix them.

License remains Apache-2.0. This note is not a clearance to ship LEAN inside a customer image. `LEAN_EXECUTION.ran` stays false because the TypeScript module does not spawn the engine.

## Pin

Inspected 2026-11-11 from the GitHub API and from raw files at that commit. Nothing was checked out.

| Field | Value |
| --- | --- |
| Repo | https://github.com/QuantConnect/Lean |
| Pin | `master` commit `655ac6d475ad8539ff54583a26327e63b59c5703` |
| Commit time | 2026-11-11T23:36:44Z (author and committer) |
| Subject | Rank GreenblattMagicFormulaAlpha stocks by combined factor rank (#10083) |
| Parent | `1b4d818e3e92588dbc21e9fc9610a2dfb77c2c37` |
| Commit URL | https://github.com/QuantConnect/Lean/commit/655ac6d475ad8539ff54583a26327e63b59c5703 |

That commit is not a release tag. The tags API’s newest tag is `v2.4.0.1`, published 2017-08-08T20:57:57Z, name “R-Support, Visual Studio Integration, Python Updates”, commit `64cf1ff870bd8670cb9a3c301258f597f51a9d8c`. The README’s local install path is current master, not that 2017 tag. This track pins the master SHA above and records the tag only so it is not mistaken for the engine.

## License

`LICENSE` at `655ac6d475ad8539ff54583a26327e63b59c5703` is the Apache License, Version 2.0 (http://www.apache.org/licenses/LICENSE-2.0). Appendix:

> Copyright 2014 QuantConnect Corporation
>
> Licensed under the Apache License, Version 2.0 (the "License");

SPDX name used in the contract constant: `Apache-2.0`.

## Runtime

LEAN is a .NET process, not a Node module.

- `Launcher/QuantConnect.Lean.Launcher.csproj` at the pin: `<TargetFramework>net10.0</TargetFramework>`. Output is `QuantConnect.Lean.Launcher.dll`.
- README (macOS and Linux): install the .NET 10 SDK, `dotnet build` / `dotnet build QuantConnect.Lean.sln`, then `dotnet QuantConnect.Lean.Launcher.dll`.
- Python algorithms are supported inside that process. `Algorithm.Python/readme.md` at the pin says to get C# LEAN running first, then install Python 3.11 (`conda create -n qc_lean python=3.11.11 pandas=2.2.3 wrapt=1.16.0` on Linux) and set `PYTHONNET_PYDLL`. Algorithms are selected with `"algorithm-language": "Python"`. QuantConnect’s pythonnet supplies `Python.Runtime.dll`. Users are told not to compile that DLL themselves.
- This application's Node runtime stays on the system Python 3.10.22. The LEAN sidecar does not use that interpreter. The C# algorithm ran under the isolated .NET 10 SDK.

## Why it is not imported into this Node process

- The launcher is a `net10.0` executable. This application is TypeScript on Node. There is no LEAN package on the Node module path, and this track does not add one.
- Apache-2.0 would allow a separate process. It does not make the C# engine loadable inside the Vite/Node process.
- LEAN stays research-only. The Apex ledger and risk engine remain the source of truth. The contract fixes `placeOrders: false`. LEAN must not place broker orders.

## Typed contract

Defined in `src/lib/apex/lean/contract.ts`. A future LEAN process would accept:

- `strategyId`, `version`
- `instrumentIds`
- a small `bars` series (integer cents per share)
- `costBps` (basis points of fill notional, each side)
- `fillRule`: `"next bar open"`
- `placeOrders: false`

and would return a backtest-shaped object with:

- `tradeCount` (completed round trips)
- `netPnlCents` (integer cents, not a return)
- `engine: "lean"`
- `leanProcessRan: true`
- `pinSha` equal to the pin above
- `ordersPlaced: 0`
- `sourceOfTruth: "apex-ledger"`

`LeanEngineResult` is that shape. No function in this tree returns it. `LEAN_EXECUTION` is `{ status: "BLOCKED", reason: "no-dotnet", ran: false }`.

`assertEngineLabel` rejects `engine: "lean"` unless `leanProcessRan` is true and `processPid` is a positive integer. If those are present it still throws `LEAN execution is BLOCKED (no-dotnet)`, because a number is not a LEAN process and this sandbox cannot start one.

## Fixture smoke (not LEAN)

`src/lib/apex/lean/smoke.ts` runs one synthetic 3-bar book. It does not call LEAN. The result’s `engine` is `"fixture-not-lean"`.

Strategy `fixture-long-if-up` version `fixture-1`, instrument `FIXTURE`, quantity 100 shares, cost 10 bps per side.

| Bar | Timestamp | Open | High | Low | Close | Volume |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 0 | 2024-01-02T14:30:00.000Z | 10000 | 10100 | 9900 | 10050 | 1000 |
| 1 | 2024-01-02T15:00:00.000Z | 10080 | 10200 | 10040 | 10150 | 1100 |
| 2 | 2024-01-02T15:30:00.000Z | 10120 | 10180 | 10090 | 10100 | 900 |

Prices are cents per share. They are not prints from a venue.

Rule: the signal reads bar 0 only. Close 10050 is above open 10000, so buy 100 shares at the next open (bar 1 open 10080). The exit is decided on bar 1 and fills at the next open (bar 2 open 10120). Bar 2’s close is not used.

Hand calculation, also written independently in `src/lib/apex/lean.test.ts`:

- gross = (10120 − 10080) × 100 = 4000 cents
- entry fee = 10080 × 100 × 10 / 10000 = 1008 cents
- exit fee = 10120 × 100 × 10 / 10000 = 1012 cents
- net = 4000 − 1008 − 1012 = 1980 cents
- trade count = 1

If bar 0 does not close above its open, trade count and net pnl are 0. A request with `placeOrders` not false throws.

## Blocker

`no-dotnet`. LEAN was not executed. Do not read 1980 cents as a market return or as a LEAN result.

## Test

Command:

```
node --experimental-strip-types --test src/lib/apex/lean.test.ts
```

Exit code 0. Captured TAP from that run:

```
TAP version 13
# Subtest: lean adapter contract
    # Subtest: matches an independent next-open hand calculation and is not LEAN
    ok 1 - matches an independent next-open hand calculation and is not LEAN
      ---
      duration_ms: 1.983738
      type: 'test'
      ...
    # Subtest: stays flat when bar 0 does not close above its open
    ok 2 - stays flat when bar 0 does not close above its open
      ---
      duration_ms: 0.305568
      type: 'test'
      ...
    # Subtest: refuses engine lean without a process
    ok 3 - refuses engine lean without a process
      ---
      duration_ms: 0.649344
      type: 'test'
      ...
    # Subtest: refuses an order-placing request
    ok 4 - refuses an order-placing request
      ---
      duration_ms: 0.3387
      type: 'test'
      ...
    1..4
ok 1 - lean adapter contract
  ---
  duration_ms: 4.81343
  type: 'suite'
  ...
1..1
# tests 4
# suites 1
# pass 4
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 170.270874
```

Pass/fail: **pass 4, fail 0**.
