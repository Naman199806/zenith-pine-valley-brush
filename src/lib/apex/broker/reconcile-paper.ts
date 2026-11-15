export interface BrokerSnapshot {
  account: { status: string; cash: string } | null;
  positions: Array<{ symbol: string; qty: string }> | null;
  openOrders: Array<{ id: string; client_order_id: string; status: string }> | null;
  recentOrders: Array<{ id: string; client_order_id: string; status: string; filled_qty: string }> | null;
}

export function reconcile(localQty: number, snap: BrokerSnapshot): { ok: boolean; entriesBlocked: boolean; notes: string[] } {
  const notes: string[] = [];
  if (!snap.account || !snap.positions || !snap.openOrders || !snap.recentOrders) {
    return { ok: false, entriesBlocked: true, notes: ["incomplete broker snapshot"] };
  }
  const brokerQty = snap.positions.reduce((sum, p) => sum + Number(p.qty || 0), 0);
  if (Math.abs(brokerQty - localQty) > 1e-8) notes.push(`position mismatch local=${localQty} broker=${brokerQty}`);
  const unknown = snap.openOrders.filter((o) => !o.client_order_id);
  if (unknown.length) notes.push("open order missing client order id");
  return { ok: notes.length === 0, entriesBlocked: notes.length > 0, notes };
}

export async function readSnapshot(transport: { get(url: string): Promise<{ status: number; body: unknown }> }): Promise<BrokerSnapshot> {
  async function one(url: string): Promise<unknown> {
    const res = await transport.get(url);
    if (res.status !== 200) throw new Error(`${url} status ${res.status}`);
    if (res.body == null) throw new Error(`${url} empty body`);
    return res.body;
  }
  const origin = "https://paper-api.alpaca.markets";
  const account = await one(`${origin}/v2/account`) as BrokerSnapshot["account"];
  const positions = await one(`${origin}/v2/positions`) as BrokerSnapshot["positions"];
  const openOrders = await one(`${origin}/v2/orders?status=open`) as BrokerSnapshot["openOrders"];
  const recentOrders = await one(`${origin}/v2/orders?status=all&limit=20`) as BrokerSnapshot["recentOrders"];
  return { account, positions, openOrders, recentOrders };
}
