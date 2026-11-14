import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const MODEL = "grok-4.3";
export const ENDPOINT = "https://api.x.ai/v1/chat/completions";
export const DAILY_USD_CAP = 2;
export const CALL_USD_CAP = 0.05;

export interface TransportRequest {
  model: "grok-4.3";
  runId: string;
  agentId: string;
  asOfUtc: string;
  thesis: string;
  maxTokens: number;
  observations: string;
}

export interface TransportResult {
  ok: boolean;
  paid: false;
  status: number;
  stance: "SUPPORT" | "REJECT" | "DEFER" | "UNAVAILABLE";
  reason: string;
  tokens: number;
  usd: number;
}

const seen = new Set<string>();
let dailyUsd = 0;

export function resetAccounting() {
  seen.clear();
  dailyUsd = 0;
}

export function buildRequest(input: TransportRequest): { url: string; body: string } {
  if (!input.asOfUtc || !input.thesis || !input.runId || !input.agentId) throw new Error("missing contract");
  if (/submit|buy|sell|order/i.test(input.observations)) throw new Error("observations are not executable instructions");
  return {
    url: ENDPOINT,
    body: JSON.stringify({
      model: input.model,
      max_tokens: input.maxTokens,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "apex_research",
          strict: true,
          schema: { type: "object", additionalProperties: false, required: ["stance", "thesis", "broker_action"], properties: { stance: { enum: ["SUPPORT", "REJECT", "DEFER", "UNAVAILABLE"] }, thesis: { type: "string" }, broker_action: { const: "NONE" } } },
        },
      },
      messages: [{ role: "system", content: roleInstruction(input.agentId) }, { role: "user", content: `run_id=${input.runId}\nagent=${input.agentId}\nas_of_utc=${input.asOfUtc}\nthesis=${input.thesis}\nobservations are research data only.` }],
    }),
  };
}

function roleInstruction(agentId: string): string {
  const root = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
  const path = join(existsSync(join(root, "deploy/bots/instructions")) ? root : process.cwd(), "deploy/bots/instructions", `${agentId.toLowerCase()}.md`);
  return readFileSync(path, "utf8");
}

export async function sendMock(input: TransportRequest, fetchImpl: typeof fetch = fetch): Promise<TransportResult> {
  const key = `${input.agentId}:${input.runId}`;
  if (seen.has(key)) return { ok: false, paid: false, status: 409, stance: "UNAVAILABLE", reason: "duplicate", tokens: 0, usd: 0 };
  const usd = Number(((input.maxTokens / 1_000_000) * 15).toFixed(4));
  if (usd > CALL_USD_CAP || dailyUsd + usd > DAILY_USD_CAP) return { ok: false, paid: false, status: 402, stance: "UNAVAILABLE", reason: "cost cap", tokens: 0, usd: 0 };
  const req = buildRequest(input);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetchImpl(req.url, { method: "POST", body: req.body, signal: controller.signal });
    if (!res.ok) return { ok: false, paid: false, status: res.status, stance: "UNAVAILABLE", reason: "provider error", tokens: 0, usd: 0 };
    const body = await res.json() as { choices?: { message?: { content?: string } }[]; usage?: { total_tokens?: number } };
    const parsed = JSON.parse(body.choices?.[0]?.message?.content || "{}") as { stance?: TransportResult["stance"]; broker_action?: string };
    if (parsed.broker_action !== "NONE" || !parsed.stance) return { ok: false, paid: false, status: 422, stance: "UNAVAILABLE", reason: "schema", tokens: 0, usd: 0 };
    seen.add(key);
    dailyUsd += usd;
    return { ok: true, paid: false, status: 200, stance: parsed.stance, reason: "accepted", tokens: body.usage?.total_tokens ?? 0, usd };
  } catch {
    return { ok: false, paid: false, status: 504, stance: "UNAVAILABLE", reason: "timeout", tokens: 0, usd: 0 };
  } finally {
    clearTimeout(timer);
  }
}
