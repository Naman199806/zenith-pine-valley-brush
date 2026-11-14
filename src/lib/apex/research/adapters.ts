import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ROLES } from "./protocol.ts";
import { sendMock, type TransportRequest } from "./transport.ts";

export function roleReady(role: string): boolean {
  const root = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
  const base = existsSync(join(root, "deploy/bots/instructions")) ? root : process.cwd();
  return existsSync(join(base, "deploy/bots/instructions", `${role}.md`));
}

export function readyCount(): number {
  return ROLES.filter(roleReady).length;
}

export function bearPacket(): TransportRequest {
  return {
    model: "grok-4.3",
    runId: "bear-xai-live-smoke-001",
    agentId: "bear",
    asOfUtc: "2026-11-12T23:59:59Z",
    thesis: "The supplied BTC/USD daily bars indicate a bearish short-term trend regime.",
    maxTokens: 1600,
    observations: "completed bars only",
  };
}

export async function mockAll(fetchImpl: typeof fetch) {
  const out = [];
  for (const role of ROLES) {
    out.push(await sendMock({
      model: "grok-4.3",
      runId: `mock-${role}`,
      agentId: role,
      asOfUtc: "2026-11-12T00:00:00Z",
      thesis: "descriptive research only",
      maxTokens: 200,
      observations: "completed bars only",
    }, fetchImpl));
  }
  return out;
}
