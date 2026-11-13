export interface MockFill {
  clientId: string;
  qty: number;
  price: number;
  feeBps: number;
}

export function mockRoundTrip(fill: MockFill): { cash: number; position: number; pnl: number } {
  const fee = fill.qty * fill.feeBps / 10000;
  const bought = fill.qty - fee;
  const sell = bought * fill.price * (1 - fill.feeBps / 10000);
  const cost = fill.qty * fill.price;
  return { cash: sell - cost, position: 0, pnl: sell - cost };
}
