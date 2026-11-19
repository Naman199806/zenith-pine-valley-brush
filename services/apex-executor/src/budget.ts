/**
 * Shared Alpaca Trading API budget.
 * The quote on data.alpaca.markets is not part of this count.
 * A call that would exceed the window is refused before it is sent.
 */

export const TRADING_API_BUDGET_PER_MIN = 150;
export const BUDGET_RESERVE = 10;
export const SNAPSHOT_TRADING_GETS = 4;
export const PER_ORDER_TRADING_GETS = 3;
export const BUDGET_WINDOW_MS = 60_000;

export interface BudgetMath {
  budgetPerMin?: number;
  reserve?: number;
  pollIntervalMs?: number;
  snapshotGets?: number;
  perOrderGets?: number;
}

/**
 * polls/min = 60000 / interval.
 * Each poll spends snapshotGets plus perOrderGets for every in-flight order.
 * Reserve is held back for one submit, one cancel, and a recovery lookup.
 * cap = floor(((budget - reserve) / pollsPerMin - snapshotGets) / perOrderGets).
 * Defaults: (150 - 10) / 20 - 4 = 3, divided by 3, equals 1.
 */
export function outstandingOrderCap(input: BudgetMath = {}): number {
  const budget = input.budgetPerMin ?? TRADING_API_BUDGET_PER_MIN;
  const reserve = input.reserve ?? BUDGET_RESERVE;
  const interval = input.pollIntervalMs ?? 3_000;
  const snapshot = input.snapshotGets ?? SNAPSHOT_TRADING_GETS;
  const perOrder = input.perOrderGets ?? PER_ORDER_TRADING_GETS;
  if (!Number.isFinite(budget) || !Number.isFinite(reserve) || !Number.isFinite(interval) || !Number.isFinite(snapshot) || !Number.isFinite(perOrder)) return 0;
  if (!(budget > 0) || reserve < 0 || !(interval > 0) || snapshot < 0 || !(perOrder > 0)) return 0;
  if (reserve >= budget) return 0;
  const polls = 60_000 / interval;
  if (!Number.isFinite(polls) || !(polls > 0)) return 0;
  const room = (budget - reserve) / polls - snapshot;
  if (!(room >= perOrder)) return 0;
  return Math.floor(room / perOrder);
}

export function pollTradingCost(inFlight: number, input: BudgetMath = {}): number {
  const snapshot = input.snapshotGets ?? SNAPSHOT_TRADING_GETS;
  const perOrder = input.perOrderGets ?? PER_ORDER_TRADING_GETS;
  if (!Number.isInteger(inFlight) || inFlight < 0) return Number.POSITIVE_INFINITY;
  return snapshot + perOrder * inFlight;
}

/** Sliding window. A backward clock refuses. Cost must be a positive integer. */
export class RequestBudget {
  private stamps: number[] = [];
  private lastNow = Number.NEGATIVE_INFINITY;
  private readonly limit: number;
  private readonly windowMs: number;

  constructor(limit = TRADING_API_BUDGET_PER_MIN, windowMs = BUDGET_WINDOW_MS) {
    if (!Number.isInteger(limit) || limit <= 0) throw new Error("request budget must be a positive integer");
    if (!Number.isInteger(windowMs) || windowMs <= 0) throw new Error("request budget window must be a positive integer");
    this.limit = limit;
    this.windowMs = windowMs;
  }

  used(now: number): number {
    if (now < this.lastNow) return this.limit;
    this.evict(now);
    return this.stamps.length;
  }

  canTake(now: number, cost: number): boolean {
    if (!Number.isInteger(cost) || cost <= 0 || cost > this.limit) return false;
    if (now < this.lastNow) return false;
    this.evict(now);
    return this.stamps.length + cost <= this.limit;
  }

  tryTake(now: number, cost: number): boolean {
    if (!this.canTake(now, cost)) return false;
    for (let i = 0; i < cost; i += 1) this.stamps.push(now);
    this.lastNow = now;
    return true;
  }

  private evict(now: number): void {
    this.stamps = this.stamps.filter((stamp) => stamp <= now && now - stamp < this.windowMs);
  }
}
