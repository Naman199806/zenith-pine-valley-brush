export interface BrokerOrder { id: string; client_order_id: string; status: string; symbol?: string; filled_qty?: string; }
export interface BrokerSnapshot {
  account: { status: string; cash: string } | null;
  positions: Array<{ symbol: string; qty: string }> | null;
  openOrders: BrokerOrder[] | null;
  recentOrders: BrokerOrder[] | null;
}

export function reconcile(local: Record<string, number>, snap: BrokerSnapshot, knownClientIds: string[] = []): { ok: boolean; entriesBlocked: boolean; notes: string[] } {
  const notes: string[] = [];
  if (!snap.account || !snap.positions || !snap.openOrders || !snap.recentOrders) return { ok: false, entriesBlocked: true, notes: ["incomplete broker snapshot"] };
  if (snap.account.status !== "ACTIVE") notes.push(`account status ${snap.account.status}`);
  const broker = new Map(snap.positions.map((p) => [p.symbol, Number(p.qty || 0)]));
  const symbols = new Set([...Object.keys(local), ...broker.keys()]);
  for (const symbol of symbols) {
    const left = local[symbol] ?? 0;
    const right = broker.get(symbol) ?? 0;
    if (Math.abs(left - right) > 1e-8) notes.push(`${symbol}: local=${left} broker=${right}`);
  }
  const known = new Set(knownClientIds);
  for (const order of [...snap.openOrders, ...snap.recentOrders]) {
    if (!order.client_order_id) notes.push(`order ${order.id} missing client order id`);
    else if (known.size && !known.has(order.client_order_id) && order.status !== "canceled") notes.push(`unmatched client order ${order.client_order_id}`);
  }
  return { ok: notes.length === 0, entriesBlocked: notes.length > 0, notes };
}

export async function readSnapshot(transport: { get(url: string): Promise<{ status: number; body: unknown }> }, origin = "https://paper-api.alpaca.markets"): Promise<BrokerSnapshot> {
  if (origin.includes("api.alpaca.markets") && !origin.includes("paper-api")) throw new Error("live origin is not permitted in the paper reconciler");
  async function one(url: string): Promise<unknown> {
    const res = await transport.get(url);
    if (res.status !== 200 || res.body == null) throw new Error(`${url} status ${res.status}`);
    return res.body;
  }
  const account = await one(`${origin}/v2/account`) as BrokerSnapshot["account"];
  const positions = await one(`${origin}/v2/positions`) as BrokerSnapshot["positions"];
  const openOrders = await one(`${origin}/v2/orders?status=open`) as BrokerSnapshot["openOrders"];
  const recent: BrokerOrder[] = [];
  for (let page = 1; page <= 3; page++) {
    const batch = await one(`${origin}/v2/orders?status=all&limit=50&page=${page}`) as BrokerOrder[];
    recent.push(...batch);
    if (batch.length < 50) break;
  }
  return { account, positions, openOrders, recentOrders: recent };
}

export async function lookupByClientId(transport: { get(url: string): Promise<{ status: number; body: unknown }> }, clientId: string): Promise<BrokerOrder | null> {
  const url = `https://paper-api.alpaca.markets/v2/orders:by_client_order_id?client_order_id=${encodeURIComponent(clientId)}`;
  const res = await transport.get(url);
  if (res.status === 404) return null;
  if (res.status !== 200) throw new Error(`lookup status ${res.status}`);
  return res.body as BrokerOrder;
}
