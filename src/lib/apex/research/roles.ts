import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { completedBars, type ResearchInput } from "../bots/packet.ts";
import { decide } from "./decide.ts";

export const ROLES = ["scout","vector","atlas","oracle","pulse","volta","bull","bear","sigma","sentinel","allocator","pilot","hermes"] as const;
export type RoleId = (typeof ROLES)[number];

export interface RoleResult {
  provenance: "XAI_API";
  role: RoleId;
  stance: "SUPPORT" | "REJECT" | "DEFER" | "UNAVAILABLE";
  reason: string;
  broker_action: "NONE";
}

export interface ModelClient {
  complete(prompt: string): Promise<{ text: string; tokens: number }>;
}

function projectRoot() {
  const here = dirname(fileURLToPath(import.meta.url));
  const fromFile = join(here, "../../../..");
  if (existsSync(join(fromFile, "deploy/bots/instructions/scout.md"))) return fromFile;
  if (existsSync(join(process.cwd(), "deploy/bots/instructions/scout.md"))) return process.cwd();
  return fromFile;
}

export function instruction(role: RoleId, root = projectRoot()): string {
  return readFileSync(join(root, "deploy/bots/instructions", `${role}.md`), "utf8");
}

export async function runRole(role: RoleId, input: ResearchInput, client: ModelClient): Promise<RoleResult> {
  const bars = completedBars(input);
  if (bars.length === 0) return { provenance: "XAI_API", role, stance: "UNAVAILABLE", reason: "no completed bars", broker_action: "NONE" };
  if ((role === "atlas" || role === "volta") && input.symbol.includes("BTC")) {
    return { provenance: "XAI_API", role, stance: "UNAVAILABLE", reason: "out of scope", broker_action: "NONE" };
  }
  const raw = await client.complete(`${instruction(role)}\nsymbol=${input.symbol}`);
  const parsed = JSON.parse(raw.text) as { stance?: RoleResult["stance"] };
  return { provenance: "XAI_API", role, stance: parsed.stance ?? "DEFER", reason: "mock", broker_action: "NONE" };
}

export async function cycle(input: ResearchInput, client: ModelClient, opts: { quantOk: boolean; riskOk: boolean; strategyApproved: boolean }) {
  const roles = [];
  for (const role of ROLES) roles.push(await runRole(role, input, client));
  const bear = roles.find((r) => r.role === "bear");
  const decision = decide({
    instrument: input.symbol,
    quantOk: opts.quantOk,
    riskOk: opts.riskOk,
    strategyApproved: opts.strategyApproved,
    agent: { stance: bear?.stance ?? "UNAVAILABLE", evidenceId: input.source, asOf: input.asOf },
  });
  return { roles, decision, paidCalls: 0, brokerWrites: 0 };
}
