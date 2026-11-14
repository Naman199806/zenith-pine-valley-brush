export interface CostSpec {
  commissionBps: number;
  slippageBps: number;
}

export interface Fill {
  raw: number;
  execution: number;
  commission: number;
  cashOutflow: number;
}

export function executionPrice(raw: number, side: "buy" | "sell", slippageBps: number): number {
  const slip = slippageBps / 10_000;
  return side === "buy" ? raw * (1 + slip) : raw * (1 - slip);
}

export function commissionCash(notional: number, commissionBps: number): number {
  return Math.abs(notional) * commissionBps / 10_000;
}

export function buy(raw: number, qty: number, spec: CostSpec): Fill {
  const execution = executionPrice(raw, "buy", spec.slippageBps);
  const commission = commissionCash(qty * execution, spec.commissionBps);
  return { raw, execution, commission, cashOutflow: qty * execution + commission };
}

export function sell(raw: number, qty: number, spec: CostSpec): Fill {
  const execution = executionPrice(raw, "sell", spec.slippageBps);
  const commission = commissionCash(qty * execution, spec.commissionBps);
  return { raw, execution, commission, cashOutflow: -(qty * execution - commission) };
}
