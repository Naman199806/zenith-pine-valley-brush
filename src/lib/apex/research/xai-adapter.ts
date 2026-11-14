import { readFileSync } from "node:fs";
import { join } from "node:path";
import { completedBars, type ResearchInput } from "../bots/packet.ts";

export type Stance = "SUPPORT" | "REJECT" | "DEFER" | "UNAVAILABLE";
export type Provenance = "XAI_API" | "GROK_BOT_WEBHOOK" | "MANUAL_COPY";

export interface ResearchRequest {
  runId: string;
  agentId: "Vector" | "Bear";
  symbol: string;
  asOfUtc: string;
  thesis: string;
  input: ResearchInput;
  horizon: string;
}

export interface ResearchResult {
  schema_version: "apex-bot-research-v1";
  provenance: Provenance;
  run_id: string;
  agent_id: string;
  symbol: string;
  as_of_utc: string;
  stance: Stance;
  thesis: string;
  broker_action: "NONE";
  observations: { claim: string; source: string }[];
}

export interface ModelClient {
  complete(prompt: string): Promise<{ text: string; tokens: number }>;
}

const accepted = new Set<string>();

export function loadRoleInstruction(agentId: "Vector" | "Bear", root = process.cwd()): string {
  return readFileSync(join(root, "deploy/bots/instructions", `${agentId.toLowerCase()}.md`), "utf8");
}

export function buildPrompt(request: ResearchRequest, root = process.cwd()): string {
  const bars = completedBars(request.input);
  return [
    loadRoleInstruction(request.agentId, root),
    `run_id=${request.runId}`,
    `agent_id=${request.agentId}`,
    `symbol=${request.symbol}`,
    `as_of_utc=${request.asOfUtc}`,
    `thesis=${request.thesis}`,
    `horizon=${request.horizon}`,
    `completed_bars=${bars.length}`,
    `source=${request.input.source}`,
    "Return JSON only. broker_action must be NONE.",
  ].join("\n");
}

export function validate(result: ResearchResult): { ok: boolean; reason: string } {
  if (result.provenance !== "XAI_API") return { ok: false, reason: "provenance" };
  if (result.broker_action !== "NONE") return { ok: false, reason: "broker_action" };
  if (!result.as_of_utc || !result.thesis) return { ok: false, reason: "missing_contract" };
  if (!["SUPPORT", "REJECT", "DEFER", "UNAVAILABLE"].includes(result.stance)) return { ok: false, reason: "stance" };
  const key = `${result.agent_id}:${result.run_id}`;
  if (accepted.has(key)) return { ok: false, reason: "replay" };
  accepted.add(key);
  return { ok: true, reason: "accepted" };
}

export async function runAgent(request: ResearchRequest, client: ModelClient): Promise<ResearchResult> {
  const bars = completedBars(request.input);
  if (bars.length === 0) {
    return {
      schema_version: "apex-bot-research-v1",
      provenance: "XAI_API",
      run_id: request.runId,
      agent_id: request.agentId,
      symbol: request.symbol,
      as_of_utc: request.asOfUtc,
      stance: "UNAVAILABLE",
      thesis: request.thesis,
      broker_action: "NONE",
      observations: [],
    };
  }
  const raw = await client.complete(buildPrompt(request));
  const parsed = JSON.parse(raw.text) as ResearchResult;
  return { ...parsed, provenance: "XAI_API", broker_action: "NONE" };
}

export function estimateCycleCost(inputTokens = 2000, outputTokens = 800): { model: string; usd: number; note: string } {
  // Conservative placeholder until a priced smoke test is authorized.
  const usd = (inputTokens / 1_000_000) * 3 + (outputTokens / 1_000_000) * 15;
  return { model: "grok-4", usd: Number(usd.toFixed(4)), note: "estimate only; no live call made" };
}
