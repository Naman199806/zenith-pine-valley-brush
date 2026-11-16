#!/usr/bin/env node
/**
 * Apex Executor process. PAPER read-only. Does not submit to Alpaca.
 * node --experimental-strip-types services/apex-executor/src/main.ts
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { orderFromBroker } from "../../../src/lib/apex/broker/client.ts";
import { paperGet } from "../../../src/lib/apex/broker/paper-read.ts";
import { readPaperSnapshot, type EvidenceSource } from "./broker.ts";
import { assertNoLiveCreds, loadPaperCredentials } from "./credentials.ts";
import { Executor } from "./runtime.ts";

function killRequested(env: NodeJS.ProcessEnv): boolean {
  if (env.APEX_EXECUTOR_KILL === "1") return true;
  const file = env.APEX_EXECUTOR_KILL_FILE;
  return Boolean(file && existsSync(file));
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > 65_536) throw new Error("body too large");
    chunks.push(buf);
  }
  if (size === 0) return null;
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, { "content-type": typeof body === "string" ? "text/plain" : "application/json" });
  res.end(payload);
}

export function createExecutorServer(exec: Executor, token: string): Server {
  return createServer(async (req, res) => {
    if (!token || req.headers["x-executor-token"] !== token) {
      send(res, 401, "unauthorized");
      return;
    }
    try {
      if (req.method === "GET" && req.url === "/health") {
        send(res, 200, exec.health());
        return;
      }
      if (req.method === "POST" && req.url === "/kill") {
        const body = await readBody(req);
        const enabled = Boolean(body && typeof body === "object" && (body as { enabled?: boolean }).enabled === true);
        exec.setKill(enabled);
        send(res, 200, exec.health());
        return;
      }
      if (req.method === "POST" && req.url === "/instructions") {
        const body = await readBody(req);
        const result = await exec.handle(body, Date.now());
        send(res, result.accepted ? 202 : 422, result);
        return;
      }
      send(res, 404, "not found");
    } catch {
      send(res, 400, "bad request");
    }
  });
}

export async function boot(env: NodeJS.ProcessEnv = process.env): Promise<{ exec: Executor; server: Server }> {
  assertNoLiveCreds(env);
  const paper = loadPaperCredentials(env);
  const journalPath = env.APEX_EXECUTOR_JOURNAL || "services/apex-executor/data/orders.jsonl";
  const hermesPath = env.APEX_EXECUTOR_HERMES || "services/apex-executor/data/hermes.json";
  const evidence: EvidenceSource = paper
    ? { kind: "alpaca-paper", load: (now) => readPaperSnapshot(paper, new Date(now)) }
    : { kind: "unconfigured", load: async () => { throw new Error("paper credentials not configured"); } };
  const exec = new Executor({
    journalPath,
    hermesPath,
    evidence,
    operatorSecret: env.APEX_OPERATOR_SECRET ?? null,
    gateSecret: env.APEX_GATE_SECRET ?? null,
    killSwitch: killRequested(env),
    redact: paper ? [paper.keyId, paper.secret] : [],
  });
  await exec.recover(async (clientOrderId) => {
    if (!paper) throw new Error("broker credentials unavailable");
    const res = await paperGet(paper, `/v2/orders:by_client_order_id?client_order_id=${encodeURIComponent(clientOrderId)}`);
    if (res.status === 404) return null;
    if (res.status !== 200) throw new Error("reconcile lookup failed");
    return orderFromBroker(res.body);
  });
  const token = env.APEX_EXECUTOR_HEALTH_TOKEN || "";
  const port = Number(env.APEX_EXECUTOR_PORT || 8787);
  const server = createExecutorServer(exec, token);
  await new Promise<void>((resolve) => {
    server.listen(port, "127.0.0.1", () => resolve());
  });
  console.log(JSON.stringify({ ...exec.health(), port, host: "127.0.0.1" }));
  return { exec, server };
}

function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (invokedDirectly()) {
  boot().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "executor failed");
    process.exit(1);
  });
}
