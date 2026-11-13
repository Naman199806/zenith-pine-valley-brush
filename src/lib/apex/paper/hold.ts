export function due(filledAt: number, now: number, holdMs = 5 * 60 * 1000): boolean {
  return now - filledAt >= holdMs;
}

export function exitOwned(owned: number): { qty: number; flat: boolean } {
  if (owned <= 0) return { qty: 0, flat: false };
  return { qty: owned, flat: false };
}
