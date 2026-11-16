/**
 * Single description of the Linux VM layout.
 * The systemd unit, env template, and loadConfig() must match this.
 */

import { loadConfig } from "./runtime.ts";

export const DEPLOY = {
  user: "apex-executor",
  workingDirectory: "/opt/apex-quant-x",
  environmentFile: "/etc/apex-executor/secrets.env",
  dataDir: "/var/lib/apex-executor",
  statePath: "/var/lib/apex-executor/state.json",
  lockPath: "/var/lib/apex-executor/writer.lock",
  inboxPath: "/var/lib/apex-executor/inbox.jsonl",
  journalPath: "/var/lib/apex-executor/journal.jsonl",
  hermesPath: "/var/lib/apex-executor/hermes.json",
  fillsPath: "/var/lib/apex-executor/fills.jsonl",
  paperSecretsFile: "/etc/apex-executor/paper.json",
  host: "127.0.0.1",
  port: "8787",
} as const;

export function checkDeployConfig(unitText: string, envText: string): string[] {
  const problems: string[] = [];
  const required = [
    `User=${DEPLOY.user}`,
    `WorkingDirectory=${DEPLOY.workingDirectory}`,
    `EnvironmentFile=-${DEPLOY.environmentFile}`,
    `Environment=APEX_EXECUTOR_DATA=${DEPLOY.dataDir}`,
    `Environment=APEX_EXECUTOR_STATE=${DEPLOY.statePath}`,
    `Environment=APEX_EXECUTOR_LOCK=${DEPLOY.lockPath}`,
    `Environment=APEX_EXECUTOR_INBOX=${DEPLOY.inboxPath}`,
    `Environment=APEX_EXECUTOR_JOURNAL=${DEPLOY.journalPath}`,
    `Environment=APEX_EXECUTOR_HERMES=${DEPLOY.hermesPath}`,
    `Environment=APEX_EXECUTOR_FILLS=${DEPLOY.fillsPath}`,
    `Environment=APEX_EXECUTOR_PAPER_SECRETS_FILE=${DEPLOY.paperSecretsFile}`,
    "Restart=on-failure",
  ];
  for (const line of required) {
    if (!unitText.includes(line)) problems.push(`systemd unit missing ${line}`);
  }
  if (/APCA_LIVE|APEX_EXECUTOR_LIVE_|LIVE_APCA/.test(unitText)) problems.push("systemd unit names live credentials");
  const env: Record<string, string> = {};
  for (const line of envText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index > 0) env[trimmed.slice(0, index)] = trimmed.slice(index + 1);
  }
  const expect: Record<string, string> = {
    APEX_EXECUTOR_DATA: DEPLOY.dataDir,
    APEX_EXECUTOR_STATE: DEPLOY.statePath,
    APEX_EXECUTOR_LOCK: DEPLOY.lockPath,
    APEX_EXECUTOR_INBOX: DEPLOY.inboxPath,
    APEX_EXECUTOR_JOURNAL: DEPLOY.journalPath,
    APEX_EXECUTOR_HERMES: DEPLOY.hermesPath,
    APEX_EXECUTOR_FILLS: DEPLOY.fillsPath,
    APEX_EXECUTOR_PAPER_SECRETS_FILE: DEPLOY.paperSecretsFile,
    APEX_EXECUTOR_PORT: DEPLOY.port,
  };
  for (const [key, value] of Object.entries(expect)) {
    if (env[key] !== value) problems.push(`env template ${key} is ${env[key] ?? "missing"}`);
  }
  if (env.APEX_EXECUTOR_LIVE_KEY_ID || env.APCA_LIVE_API_KEY_ID || env.LIVE_APCA_API_KEY_ID) problems.push("env template contains live credentials");
  const loaded = loadConfig(env);
  if (loaded.statePath !== DEPLOY.statePath || loaded.lockPath !== DEPLOY.lockPath || loaded.inboxPath !== DEPLOY.inboxPath || loaded.journalPath !== DEPLOY.journalPath || loaded.hermesPath !== DEPLOY.hermesPath || loaded.fillsPath !== DEPLOY.fillsPath) {
    problems.push("loadConfig does not match the VM paths");
  }
  if (loaded.mode !== "PAPER" || loaded.postEnabled !== false || loaded.liveCredentialsLoaded !== false) problems.push("loadConfig is not paper read-only");
  return problems;
}
