# Market support matrix

Status words: `model` means the instrument exists and cannot be ordered. `paper` means the local simulator can fill a plumbing ticket. `live` is off for every row.

| Market | Status | Instrument examples | Block |
| --- | --- | --- | --- |
| US ETFs | paper | SPY, QQQ, IWM, GLD, TLT | Plumbing only. Not evidence. |
| Other ETFs | model | EFA, EEM, DBC, VNQ, BIL | Adapter not opened. |
| US single stocks | model | none loaded | Sprint 1 and 2 did not survive free data. |
| Crypto spot | model | BTC-USD, ETH-USD | No exchange. No staking or bridging. |
| FX | model | EURUSD, USDJPY | No broker, no rollover. |
| Listed options | model | SPY 2026-12-18 500 C | No naked shorts. Greeks are not invented. |
| Equity index futures | model | MESZ26 | Leveraged. The index itself is not tradable. |
| Metal and energy futures | model | GCZ26, CLZ26 | Not the same thing as GLD or DBC. Expiry warns, no auto-roll. |
| Prediction markets | model | EVT-DEMO | Ambiguous resolution. No venue. |

Free or fixture data is not a license to trade intraday for real. Sprint 3 has Yahoo daily coverage only. Auction cost is unmeasured, and no second vendor was compared, so that protocol stays unfrozen.
