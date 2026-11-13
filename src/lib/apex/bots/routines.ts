import { BOTS } from "./registry.ts";

export interface RoutineStatus {
  id: string;
  name: string;
  url: "SET" | "MISSING";
  key: "SET" | "MISSING";
  configured: boolean;
}

export function envName(id: string, kind: "URL" | "KEY"): string {
  return `${id.toUpperCase()}_ROUTINE_${kind}`;
}

export function routineStatus(env: Record<string, string | undefined> = process.env): RoutineStatus[] {
  return BOTS.map((bot) => {
    const url = Boolean(env[envName(bot.id, "URL")]?.trim());
    const key = Boolean(env[envName(bot.id, "KEY")]?.trim());
    return { id: bot.id, name: bot.name, url: url ? "SET" : "MISSING", key: key ? "SET" : "MISSING", configured: url && key };
  });
}

export function credentialFor(id: string, env: Record<string, string | undefined> = process.env): { url: string; key: string } | null {
  const url = env[envName(id, "URL")]?.trim();
  const key = env[envName(id, "KEY")]?.trim();
  if (!url || !key) return null;
  return { url, key };
}
