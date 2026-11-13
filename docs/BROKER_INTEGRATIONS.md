# Broker integrations

No broker is integrated.

Evaluated only as future adapter candidates, not as working code: Interactive Brokers, Alpaca, a crypto exchange through something like Freqtrade’s CCXT list, and an event-contract venue. One broker will not cover all seven markets. Alpaca is mentioned in the unfrozen sprint 3 note because its auction orders match that protocol’s intended fill. That adapter does not exist here.

The paper path is an internal simulator:

- Market buys pay the fixture ask plus 2 bps. Market sells hit the bid minus 2 bps.
- A limit that does not cross rests. It is not a fill.
- A lost acknowledgement moves the order to `unknown` and does not send a second order.
- Reconcile books a missing quantity once.
- A rejected cancel stays rejected. The position remains.
- A stop can fill worse than the stop. The worse price is what the ledger stores.
- Idempotency keys collapse replays.
- `order.live` is always false.

Real keys, if they are ever provided, stay out of the browser and out of source control. That step needs an explicit decision. It is not available in this build.
