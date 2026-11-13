import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface ResearchPayload {
  schema_version: string;
  run_id: string;
  agent_id: string;
  symbol: string;
  as_of_utc: string | null;
  stance: string;
  thesis: string | null;
  broker_action: string;
  observations: unknown[];
}

const used = new Set<string>();
const tokens = new Map<string, { runId: string; agentId: string; exp: number }>();

export function issueToken(runId: string, agentId: string, ttlMs = 5 * 60 * 1000): string {
  const token = randomBytes(16).toString("hex");
  tokens.set(token, { runId, agentId, exp: Date.now() + ttlMs });
  return token;
}

export function acceptResult(input: ResearchPayload, token: string, root: string): { ok: boolean; reason: string } {
  if (input.broker_action !== "NONE") return { ok: false, reason: "broker_action" };
  if (input.stance === "SUPPORT" && !input.thesis) return { ok: false, reason: "descriptive_support" };
  if (!input.as_of_utc) return { ok: false, reason: "missing_as_of" };
  if (!input.run_id || !input.agent_id) return { ok: false, reason: "missing_ids" };
  const grant = tokens.get(token);
  if (!grant || grant.exp < Date.now() || grant.runId !== input.run_id || grant.agentId !== input.agent_id) {
    return { ok: false, reason: "bad_token" };
  }
  const digest = createHash("sha256").update(token).digest("hex");
  if (used.has(digest)) return { ok: false, reason: "replay" };
  used.add(digest);
  tokens.delete(token);
  mkdirSync(root, { recursive: true });
  const raw = join(root, `${input.run_id}.raw.json`);
  const valid = join(root, `${input.run_id}.valid.json`);
  if (existsSync(raw)) return { ok: false, reason: "duplicate" };
  writeFileSync(raw, JSON.stringify(input));
  writeFileSync(valid, JSON.stringify({ ...input, accepted: true, executable: false }));
  return { ok: true, reason: "accepted" };
}

export function tokensEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function accept(input: { botId: string; correlationId: string; asOf: string; stance: string; evidenceId: string; authenticated: boolean }, now: string): { stance: string } {
  if (!input.authenticated || !input.evidenceId || input.asOf > now) return { stance: "UNAVAILABLE" };
  return { stance: input.stance };
}

export function readStored(root: string, runId: string): string | null {
  const path = join(root, `${runId}.valid.json`);
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}
