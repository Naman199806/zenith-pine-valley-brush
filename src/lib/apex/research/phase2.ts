import { readFileSync } from "node:fs";
import { ROLES, type RoleId } from "./roles.ts";
import { evaluateFmz, completedBars, type Bar } from "./fmz-bb-rsi.ts";
import { oracleFeed, pulseFeed, voltaFeed, type FeedObservation } from "./public-feeds.ts";
import { planPaperOrder } from "../broker/paper-pipeline.ts";

export interface AgentTrace {
  role: RoleId;
  state: "DETERMINISTIC" | "NOT_APPLICABLE" | "UNAVAILABLE" | "BLOCKED";
  asOf: string;
  freshness: "FRESH" | "STALE" | "UNAVAILABLE" | "NOT_APPLICABLE";
  evidence: Record<string, unknown>;
  effect: "ADVISORY" | "VETO" | "SIZE" | "PLAN" | "JOURNAL" | "NONE";
  modelCall: false;
  error: string | null;
}

function ageHours(iso: string | null, nowMs: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? (nowMs - t) / 3600000 : null;
}

function freshness(iso: string | null, nowMs: number, maxHours: number): AgentTrace["freshness"] {
  const age = ageHours(iso, nowMs);
  if (age == null) return "UNAVAILABLE";
  return age <= maxHours ? "FRESH" : "STALE";
}

export function scanLocalUniverse(root = process.cwd()): Array<{ symbol: string; last: string | null; bars: number }> {
  const files = [
    ["BTC/USD", "research/data/raw/coinbase/20261112/BTC-USD.json", "coinbase"],
    ["ETH/USD", "research/data/raw/coinbase/20261112/ETH-USD.json", "coinbase"],
    ["SPY", "research/data/raw/yahoo/20261112/SPY.json", "yahoo"],
    ["QQQ", "research/data/raw/yahoo/20261112/QQQ.json", "yahoo"],
    ["IWM", "research/data/raw/yahoo/20261112/IWM.json", "yahoo"],
    ["GLD", "research/data/raw/yahoo/20261112/GLD.json", "yahoo"],
    ["TLT", "research/data/raw/yahoo/20261112/TLT.json", "yahoo"],
    ["BIL", "research/data/raw/yahoo/20261112/BIL.json", "yahoo"],
  ] as const;
  return files.map(([symbol, path, kind]) => {
    const raw = JSON.parse(readFileSync(`${root}/${path}`, "utf8"));
    const bars = raw.bars || [];
    const last = kind === "coinbase" ? (bars.at(-1)?.ts ? new Date(bars.at(-1).ts * 1000).toISOString() : null) : bars.at(-1)?.date ?? null;
    return { symbol, last, bars: bars.length };
  });
}

export function loadBtcBars(root = process.cwd()): Bar[] {
  const raw = JSON.parse(readFileSync(`${root}/research/data/raw/coinbase/20261112/BTC-USD.json`, "utf8")).bars;
  return completedBars(raw.map((b: { ts: number; open: number; high: number; low: number; close: number }) => ({ t: new Date(b.ts * 1000).toISOString(), o: b.open, h: b.high, l: b.low, c: b.close })));
}

export function selectFromFrozen(results: { candidates: Array<{ validation: { id: string; decision: string; netReturn: number; benchmark: number; trades: number } }> }): { selected: string; reason: string } {
  const winner = results.candidates.find((c) => c.validation.decision === "ELIGIBLE_FOR_FURTHER_VALIDATION" && c.validation.netReturn > c.validation.benchmark && c.validation.trades >= 30);
  return winner ? { selected: winner.validation.id, reason: "passed independent validation gate" } : { selected: "NO_WINNER", reason: "no frozen candidate passed independent validation" };
}

export async function runPhase2(nowMs = Date.now()): Promise<{ agents: AgentTrace[]; decision: string; selected: string; brokerWrites: 0; aiModelCalls: 0 }> {
  const asOf = new Date(nowMs).toISOString();
  const universe = scanLocalUniverse();
  const bars = loadBtcBars();
  const signal = evaluateFmz(bars, 250, nowMs);
  const [oracle, pulse, volta] = await Promise.all([oracleFeed(), pulseFeed(), voltaFeed()]);
  const latest = (items: FeedObservation[]) => items[0]?.published ?? null;
  const agents: AgentTrace[] = [
    { role: "scout", state: "DETERMINISTIC", asOf, freshness: "FRESH", evidence: { scanned: universe }, effect: "ADVISORY", modelCall: false, error: null },
    { role: "vector", state: "DETERMINISTIC", asOf, freshness: signal.barTime ? freshness(signal.barTime, nowMs, 24 * 30) : "UNAVAILABLE", evidence: { signal: signal.signal, rsi: signal.rsi, bars: signal.barsUsed, lastBar: signal.barTime }, effect: "ADVISORY", modelCall: false, error: null },
    { role: "atlas", state: "NOT_APPLICABLE", asOf, freshness: "NOT_APPLICABLE", evidence: { symbol: "BTC/USD" }, effect: "NONE", modelCall: false, error: "spot crypto has no equity fundamental statement" },
    { role: "oracle", state: oracle.state === "DETERMINISTIC" ? "DETERMINISTIC" : "UNAVAILABLE", asOf, freshness: freshness(latest(oracle.observations), nowMs, 24 * 14), evidence: { count: oracle.observations.length, latest: oracle.observations[0] ?? null }, effect: "ADVISORY", modelCall: false, error: oracle.error },
    { role: "pulse", state: pulse.state === "DETERMINISTIC" ? "DETERMINISTIC" : "UNAVAILABLE", asOf, freshness: freshness(latest(pulse.observations), nowMs, 24 * 14), evidence: { count: pulse.observations.length, latest: pulse.observations[0] ?? null, kind: "sec-press-release" }, effect: "ADVISORY", modelCall: false, error: pulse.error },
    { role: "volta", state: volta.state === "DETERMINISTIC" ? "DETERMINISTIC" : "UNAVAILABLE", asOf, freshness: freshness(latest(volta.observations), nowMs, 24 * 5), evidence: { count: volta.observations.length, latest: volta.observations[0] ?? null, limitation: "VIX index only; not options positioning" }, effect: "ADVISORY", modelCall: false, error: volta.error },
    { role: "bull", state: "BLOCKED", asOf, freshness: "UNAVAILABLE", evidence: {}, effect: "NONE", modelCall: false, error: "paid Bull call blocked" },
    { role: "bear", state: "BLOCKED", asOf, freshness: "UNAVAILABLE", evidence: {}, effect: "NONE", modelCall: false, error: "paid Bear call blocked" },
  ];
  const frozen = JSON.parse(readFileSync("research/lab/competition-20261115.json", "utf8"));
  const selection = selectFromFrozen(frozen);
  const sigmaReject = selection.selected === "NO_WINNER" || signal.barsUsed < 250;
  agents.push({ role: "sigma", state: "DETERMINISTIC", asOf, freshness: "FRESH", evidence: { selected: selection.selected, signal: signal.signal }, effect: sigmaReject ? "VETO" : "ADVISORY", modelCall: false, error: null });
  const reasons = ["strategyApproved=false", selection.reason, "XAI_BILLING_LOCK active"];
  agents.push({ role: "sentinel", state: "DETERMINISTIC", asOf, freshness: "FRESH", evidence: { reasons }, effect: "VETO", modelCall: false, error: null });
  agents.push({ role: "allocator", state: "DETERMINISTIC", asOf, freshness: "FRESH", evidence: { skipped: true, maxUsd: 25 }, effect: "SIZE", modelCall: false, error: "no eligible BUY after Sigma/Sentinel" });
  const plan = planPaperOrder({ signal: "WAIT", price: bars.at(-1)?.c ?? 0, cash: 0, maxNotional: 25, strategyApproved: false, riskOk: false, billingLocked: true, authorizationExpiresAt: null, nowMs, ownedQty: 0, endpoint: "https://paper-api.alpaca.markets/v2/orders" });
  agents.push({ role: "pilot", state: "DETERMINISTIC", asOf, freshness: "FRESH", evidence: plan, effect: "PLAN", modelCall: false, error: null });
  agents.push({ role: "hermes", state: "DETERMINISTIC", asOf, freshness: "FRESH", evidence: { journal: true, decision: "NO_TRADE" }, effect: "JOURNAL", modelCall: false, error: null });
  if (agents.length !== ROLES.length) throw new Error("agent count mismatch");
  return { agents, decision: "NO_TRADE", selected: selection.selected, brokerWrites: 0, aiModelCalls: 0 };
}
