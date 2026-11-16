/**
 * Paper and live brokerage credentials stay isolated.
 * Live material is never read unless LIVE mode is explicitly enabled,
 * and this sprint does not load it even then. Nothing here is logged.
 */

import { readFileSync } from "node:fs";
import { parsePaperKeys } from "../../../src/lib/apex/broker/keys.ts";
import { assertPaperCreds, type PaperCreds } from "../../../src/lib/apex/broker/paper-read.ts";

export const LIVE_ENABLE_PHRASE = "I_ENABLE_LIVE";

const LIVE_ENV = [
  "APEX_EXECUTOR_LIVE_KEY_ID",
  "APEX_EXECUTOR_LIVE_SECRET",
  "APEX_EXECUTOR_LIVE_SECRETS_FILE",
  "LIVE_APCA_API_KEY_ID",
  "LIVE_APCA_API_SECRET_KEY",
  "APCA_LIVE_API_KEY_ID",
  "APCA_LIVE_API_SECRET_KEY",
] as const;

export function liveModeExplicitlyEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.APEX_EXECUTOR_ENABLE_LIVE === LIVE_ENABLE_PHRASE && env.APEX_EXECUTOR_MODE === "LIVE";
}

export function assertNoLiveCreds(env: NodeJS.ProcessEnv): void {
  if (liveModeExplicitlyEnabled(env)) return;
  for (const key of LIVE_ENV) {
    if (env[key]) throw new Error("LIVE credentials must not be loaded unless LIVE mode is explicitly enabled");
  }
}

export function loadPaperCredentials(
  env: NodeJS.ProcessEnv,
  readFile: (path: string, encoding: "utf8") => string = readFileSync,
): PaperCreds | null {
  let keyId = env.APEX_EXECUTOR_PAPER_KEY_ID;
  let secret = env.APEX_EXECUTOR_PAPER_SECRET;
  const file = env.APEX_EXECUTOR_PAPER_SECRETS_FILE;
  if (file) {
    let raw = "";
    try {
      raw = readFile(file, "utf8");
    } catch {
      throw new Error("paper secrets file is unreadable");
    }
    let parsed: { keyId?: unknown; secret?: unknown };
    try {
      parsed = JSON.parse(raw) as { keyId?: unknown; secret?: unknown };
    } catch {
      throw new Error("paper secrets file is not valid json");
    }
    if (typeof parsed.keyId === "string") keyId = parsed.keyId;
    if (typeof parsed.secret === "string") secret = parsed.secret;
  }
  if (!keyId && !secret) return null;
  const keys = parsePaperKeys(keyId, secret);
  if (!keys.ok) throw new Error(keys.reason);
  const creds = { keyId: keys.keyId, secret: keys.secret };
  const err = assertPaperCreds(creds);
  if (err) throw new Error(err);
  return creds;
}

/**
 * Live credentials are not returned in this sprint.
 * The readFile argument exists so tests can prove the live file is never opened.
 */
export function loadLiveCredentials(
  env: NodeJS.ProcessEnv,
  readFile: (path: string, encoding: "utf8") => string = readFileSync,
): null {
  if (!liveModeExplicitlyEnabled(env)) return null;
  void env.APEX_EXECUTOR_LIVE_SECRETS_FILE;
  void env.APEX_EXECUTOR_LIVE_KEY_ID;
  void env.APEX_EXECUTOR_LIVE_SECRET;
  void readFile;
  return null;
}
