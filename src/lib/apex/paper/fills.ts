export interface Partial {
  requested: number;
  filled: number;
  remaining: number;
  owned: number;
}

export function applyFill(requested: number, filled: number): Partial {
  if (filled > requested) throw new Error("fill exceeds request");
  return { requested, filled, remaining: requested - filled, owned: filled };
}

export function exitQty(owned: number, requestedSell: number): number {
  return Math.min(owned, requestedSell);
}
