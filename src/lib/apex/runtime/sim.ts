import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { cycle, ROLES } from "../research/roles.ts";
import { btcPacket } from "../bots/packet.ts";

export interface SimEvent { t: string; type: string; detail: string }

export function syntheticFixture() {
  return {
    label: "TEST_ONLY",
    symbol: "BTC/USD",
    thesis: "test fixture only",
    eligible: true,
    riskOk: true,
  };
}

export function runSynthetic(): { events: SimEvent[]; final: string; journal: string } {
  const events: SimEvent[] = [];
  const push = (type: string, detail: string) => events.push({ t: new Date().toISOString(), type, detail });
  push("RESEARCH", "13 mock roles");
  push("SIGNAL", "TEST_ONLY candidate");
  push("RISK", "approved for simulation only");
  push("ENTRY", "submitted");
  push("FILL", "partial then full");
  push("MONITOR", "open");
  push("EXIT", "submitted");
  push("FLAT", "position zero");
  push("JOURNAL", "recorded");
  push("HERMES", "proposal only, no promotion");
  return { events, final: "FLAT", journal: "TEST_ONLY synthetic trade closed" };
}

export async function runNoTrade() {
  const mock = { async complete() { return { text: JSON.stringify({ stance: "DEFER" }), tokens: 1 }; } };
  return cycle(btcPacket(), mock, { quantOk: true, riskOk: true, strategyApproved: false });
}

export function persist(path: string, value: unknown) {
  writeFileSync(path, JSON.stringify(value, null, 2));
}

export function load(path: string): unknown {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}

export { ROLES };
