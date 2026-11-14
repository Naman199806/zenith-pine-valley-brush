export interface DistributionEvent {
  symbol: string;
  exDate: string;
  amount: number;
  payableDate?: string;
}

export interface Entitlement {
  symbol: string;
  exDate: string;
  shares: number;
  amountPerShare: number;
  accrued: number;
  cashAvailable: boolean;
  reason: string;
}

export function entitle(
  events: DistributionEvent[],
  heldOnPriorClose: (symbol: string, exDate: string) => number,
): Entitlement[] {
  return events.map((event) => {
    const shares = heldOnPriorClose(event.symbol, event.exDate);
    const accrued = shares > 0 ? shares * event.amountPerShare : 0;
    const payableKnown = Boolean(event.payableDate);
    return {
      symbol: event.symbol,
      exDate: event.exDate,
      shares,
      amountPerShare: event.amountPerShare,
      accrued,
      cashAvailable: payableKnown && shares > 0,
      reason: shares <= 0
        ? "NOT_HELD_BEFORE_EX_DATE"
        : payableKnown
          ? "PAYABLE_ON_RECORDED_DATE"
          : "PAYABLE_DATE_MISSING",
    };
  });
}
