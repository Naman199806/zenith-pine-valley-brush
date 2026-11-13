# Data integrity — Sprint 3A

Second-source OHLCV comparison: **BLOCKED**.

No T1 or T2 return was computed. Adjusted close is stored aside and is not a point-in-time price.

## What was snapshotted

Provider `yahoo-chart-v8`, fetched `2026-11-12T04:05:31Z`, `period1` 631152000, interval `1d`. Session dates are the America/New_York calendar date of the vendor timestamp. UTC and New York dates disagreed on 0 bars. Null OHLC rows dropped: 0. Manifest: `research/data/manifests/yahoo-20261112.json`. Manifest sha256: `8e3a2447680a68aa89327fcb833df4379f16cb337c0469ceb99f48caa3a83b69`.

| Symbol | First | Last | Bars | Dividends | Splits | sha256 |
| --- | --- | --- | --- | --- | --- | --- |
| SPY | 1993-01-29 | 2026-11-11 | 8505 | 136 | 0 | `b7d2529962e3d4339fb0fe1e11bbc75bfba8df20d1b7e951b5a155497951a28b` |
| QQQ | 1999-03-10 | 2026-11-11 | 6963 | 90 | 1 | `bfd2870cb767de364fcaf18e770dab3718582152899ea0837b3d2be23aa6940c` |
| IWM | 2000-05-26 | 2026-11-11 | 6655 | 107 | 1 | `0ef7a4ccbb5b989cfccb72aea8c81f1f99e4c9a3a77149e4a231df27990354ce` |
| GLD | 2004-11-18 | 2026-11-11 | 5530 | 0 | 0 | `1d10160ff7036ba8d36c77062a9d5fe0b5d5ac5bbcfa152a3f6c26318bcdc5d7` |
| TLT | 2002-07-30 | 2026-11-11 | 6112 | 290 | 0 | `70de432580987764f7629985471621a052270846a1eaf904cab695a80cd4c45e` |
| BIL | 2007-05-30 | 2026-11-11 | 4896 | 129 | 1 | `a06e2f0c96745b32495fd5f43df3183c6226769e948403fe842e324c498441ef` |

OHLC and volume are the vendor's split-adjusted, dividend-unadjusted prints. `yahooAdjClose` is a side field. Using it as the accounting price is rejected by `accountingUsesAdjustedClose`. A later download whose adjusted close differs on the same date is flagged by `revisedAdjustedClose`. Gaps are not filled.

The SPY file's sha256 was recomputed from disk and matched the manifest.

## Second source

Attempts in this run, recorded on the manifest:

- Stooq `https://stooq.com/q/d/l/?s=spy.us&i=d` — timed out. No prices.
- Nasdaq historical for SPY and QQQ (`assetclass=etf`, January 2024 window) — HTTP 403. No prices.

An earlier request in this same session, saved only as a 179-byte temporary body, got HTTP 200 from Nasdaq historical for SPY with `tradesTable.rows` null and `totalRecords` 0. That is still not a tape, and it was not copied in as a price source.

No overlapping OHLCV was compared. No price-difference table is invented.

## Tests

`node --experimental-strip-types --test src/lib/apex/history.test.ts`

Checksum match and mismatch, duplicate bars, non-positive prices, missing dividend timestamps, bad split ratios, missing sessions, revised adjusted close, and the stored SPY checksum.
