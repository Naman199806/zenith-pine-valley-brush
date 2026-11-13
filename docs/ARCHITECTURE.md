# Architecture

APEX QUANT X is a modular monolith. One TypeScript runtime owns the ledger, the risk decision, and the paper order path. The browser is a command center over that runtime. It is not six trading apps sharing a folder.

## What runs

- Canonical instruments, quotes, strategy registry, and the simulated book.
- A deterministic risk engine with final authority.
- An order state machine with idempotency, reject, resting, fill, lost ack, and reconcile.
- A research desk that emits structured notes and cannot submit.
- An illustrative opening-range backtest used as a cost control.
- A paper simulator for five US ETFs. Fills are tagged plumbing, not evidence.

## What does not run

LEAN, TradingAgents, Hermes, Freqtrade, and Backtrader are not installed. GPL-3 projects (Freqtrade, Backtrader) must stay in a separate process if they are ever used. LEAN needs a .NET runtime and is the intended future research engine, behind a typed result contract, not by rewriting this ledger in C#.

There is no live broker, no credential store, and no path that sets `live` on an order. `LIVE` mode cannot be selected.

## Flow

Trade proposal, then eligibility, then risk approval, then order intent, then the execution service, then a fill or a reject, then the ledger. Agents stop before the execution service.

Cash is integer cents. Prices and quantities are integer micros. Timestamps are UTC.

## State

The server does not keep a hidden account. The simulated book is sent with each command and returned. The browser stores that book locally so a refresh keeps the paper session. Tampering still has to pass the same risk function.

## Markets

Every asset class has an instrument model. Only SPY, QQQ, IWM, GLD, and TLT can be paper-traded. Futures, options, FX, crypto, and event contracts are visible and ineligible. See `MARKET_SUPPORT_MATRIX.md`.
