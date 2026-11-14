import { buy, sell, type CostSpec } from "./costs.ts";

export interface SimEvent {
  ts: number;
  type: "submit" | "ack" | "partial" | "fill" | "cancel" | "reject";
  orderId: string;
  side: "buy" | "sell";
  qty: number;
  raw: number;
}

export interface ThroughputResult {
  label: "SYNTHETIC PERFORMANCE TEST";
  targetRoundTripsPerHour: number;
  completedRoundTrips: number;
  ordersSubmitted: number;
  ordersCanceled: number;
  ordersRejected: number;
  fills: number;
  eventsProcessed: number;
  wallClockMs: number;
  eventsPerSecond: number;
  simulatedRoundTripsPerHour: number;
  latencyMs: { p50: number; p95: number; p99: number };
  maxBacklog: number;
  endEquity: number;
  feesPaid: number;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function runFastBenchmark(targetPerHour: number, seed = 20261114, spec: CostSpec = { commissionBps: 25, slippageBps: 5 }): ThroughputResult {
  const rand = mulberry32(seed);
  const events: SimEvent[] = [];
  const interval = 3_600_000 / targetPerHour;
  for (let i = 0; i < targetPerHour; i++) {
    const ts = Math.floor(i * interval);
    const raw = 100 + rand();
    const qty = 1;
    const id = `rt-${i}`;
    events.push({ ts, type: "submit", orderId: `${id}-b`, side: "buy", qty, raw });
    events.push({ ts: ts + 5, type: "ack", orderId: `${id}-b`, side: "buy", qty, raw });
    if (rand() < 0.05) {
      events.push({ ts: ts + 8, type: "reject", orderId: `${id}-b`, side: "buy", qty, raw });
      continue;
    }
    if (rand() < 0.1) {
      events.push({ ts: ts + 10, type: "partial", orderId: `${id}-b`, side: "buy", qty: qty / 2, raw });
      events.push({ ts: ts + 12, type: "cancel", orderId: `${id}-b`, side: "buy", qty: qty / 2, raw });
    }
    events.push({ ts: ts + 15, type: "fill", orderId: `${id}-b`, side: "buy", qty, raw });
    events.push({ ts: ts + 30, type: "submit", orderId: `${id}-s`, side: "sell", qty, raw: raw + rand() - 0.5 });
    events.push({ ts: ts + 35, type: "ack", orderId: `${id}-s`, side: "sell", qty, raw });
    events.push({ ts: ts + 45, type: "fill", orderId: `${id}-s`, side: "sell", qty, raw: raw + rand() - 0.5 });
  }
  events.sort((a, b) => a.ts - b.ts || a.orderId.localeCompare(b.orderId));

  let cash = 100_000;
  let qty = 0;
  let fees = 0;
  let submitted = 0;
  let canceled = 0;
  let rejected = 0;
  let fills = 0;
  let completed = 0;
  let backlog = 0;
  let maxBacklog = 0;
  const latencies: number[] = [];
  const started = performance.now();
  for (const event of events) {
    const t0 = performance.now();
    backlog += 1;
    maxBacklog = Math.max(maxBacklog, backlog);
    if (event.type === "submit") submitted += 1;
    if (event.type === "cancel") canceled += 1;
    if (event.type === "reject") rejected += 1;
    if (event.type === "fill") {
      const fill = event.side === "buy" ? buy(event.raw, event.qty, spec) : sell(event.raw, event.qty, spec);
      cash -= fill.cashOutflow;
      fees += fill.commission;
      qty += event.side === "buy" ? event.qty : -event.qty;
      fills += 1;
      if (event.side === "sell") completed += 1;
    }
    backlog -= 1;
    latencies.push(performance.now() - t0);
  }
  const wall = performance.now() - started;
  latencies.sort((a, b) => a - b);
  const pct = (p: number) => latencies[Math.min(latencies.length - 1, Math.floor(p * latencies.length))] ?? 0;
  return {
    label: "SYNTHETIC PERFORMANCE TEST",
    targetRoundTripsPerHour: targetPerHour,
    completedRoundTrips: completed,
    ordersSubmitted: submitted,
    ordersCanceled: canceled,
    ordersRejected: rejected,
    fills,
    eventsProcessed: events.length,
    wallClockMs: Number(wall.toFixed(3)),
    eventsPerSecond: Number((events.length / (wall / 1000)).toFixed(1)),
    simulatedRoundTripsPerHour: Number((completed / (wall / 3_600_000)).toFixed(0)),
    latencyMs: { p50: Number(pct(0.5).toFixed(4)), p95: Number(pct(0.95).toFixed(4)), p99: Number(pct(0.99).toFixed(4)) },
    maxBacklog,
    endEquity: Number((cash + qty * 100).toFixed(2)),
    feesPaid: Number(fees.toFixed(2)),
  };
}

export function breakEven(spec: CostSpec, notional = 10_000): { roundTripBps: number; dollars: number } {
  const entry = buy(100, notional / 100, spec);
  const exit = sell(100, notional / 100, spec);
  const dollars = entry.cashOutflow + exit.cashOutflow;
  return { roundTripBps: Number(((dollars / notional) * 10_000).toFixed(2)), dollars: Number(dollars.toFixed(2)) };
}
