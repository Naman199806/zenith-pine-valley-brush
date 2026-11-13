/** Independent SMA 2/3 check. Not a Backtrader import. Prices are the synthetic series. */
export function smaReferenceCents(): { netCents: number; entry: number; exit: number; feesCents: number } {
  const entry = 12;
  const exit = 9;
  const qty = 10;
  const costBps = 10;
  const grossCents = (exit - entry) * 100 * qty;
  const feesCents = (entry * 100 * qty * costBps) / 10_000 + (exit * 100 * qty * costBps) / 10_000;
  return { netCents: grossCents - feesCents, entry, exit, feesCents };
}

/** Immediate custom-close fills from the LEAN fixture bars. Not the 3-bar next-open identity. */
export function leanFixtureDollars(): { entry: number; exit: number; qty: number; net: number } {
  const entry = 100.5;
  const exit = 101;
  const qty = 100;
  return { entry, exit, qty, net: (exit - entry) * qty };
}
