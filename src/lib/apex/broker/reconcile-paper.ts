export interface BrokerOrder { id: string; client_order_id: string; status: string; symbol?: string; filled_qty?: string; submitted_at?: string; }
export interface BrokerSnapshot {
  account: { status: string; cash: string } | null;
  positions: Array<{ symbol: string; qty: string }> | null;
  openOrders: BrokerOrder[] | null;
  recentOrders: BrokerOrder[] | null;
}

export function isApexClientId(clientId: string): boolean {
  return /^apex[-_]/i.test(clientId);
}

export function reconcile(local: Record<string, number>, snap: BrokerSnapshot, knownClientIds: string[]): { ok: boolean; entriesBlocked: boolean; notes: string[]; matched: number; historical: number } {
  const notes: string[] = [];
  if (!Array.isArray(knownClientIds)) return { ok: false, entriesBlocked: true, notes: ["known client order ids missing"], matched: 0, historical: 0 };
  if (!snap.account || !snap.positions || !snap.openOrders || !snap.recentOrders) return { ok: false, entriesBlocked: true, notes: ["incomplete broker snapshot"], matched: 0, historical: 0 };
  if (snap.account.status !== "ACTIVE") notes.push(`account status ${snap.account.status}`);
  const broker = new Map(snap.positions.map((p) => [p.symbol, Number(p.qty || 0)]));
  for (const symbol of new Set([...Object.keys(local), ...broker.keys()])) {
    const left = local[symbol] ?? 0;
    const right = broker.get(symbol) ?? 0;
    if (Math.abs(left - right) > 1e-8) notes.push(`${symbol}: local=${left} broker=${right}`);
  }
  const known = new Set(knownClientIds);
  let matched = 0;
  let historical = 0;
  for (const order of [...snap.openOrders, ...snap.recentOrders]) {
    if (!order.client_order_id) {
      notes.push(`order ${order.id} missing client order id`);
      continue;
    }
    if (known.has(order.client_order_id)) {
      matched += 1;
      continue;
    }
    if (isApexClientId(order.client_order_id) && order.status !== "canceled") notes.push(`unmatched Apex order ${order.client_order_id}`);
    else historical += 1;
  }
  return { ok: notes.length === 0, entriesBlocked: notes.length > 0, notes, matched, historical };
}

export function ordersUrl(origin: string, cursor?: string): string {
  const url = new URL(`${origin}/v2/orders`);
  url.searchParams.set("status", "all");
  url.searchParams.set("limit", "50");
  url.searchParams.set("direction", "desc");
  if (cursor) url.searchParams.set("before_order_id", cursor);
  return url.toString();
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
  let cursor: string | undefined;
  for (let page = 0; page < 3; page++) {
    const batch = await one(ordersUrl(origin, cursor)) as BrokerOrder[];
    recent.push(...batch);
    if (batch.length < 50 || !batch.at(-1)?.id) break;
    cursor = batch.at(-1)!.id;
  }
  return { account, positions, openOrders, recentOrders: recent };
}
