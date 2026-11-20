#!/usr/bin/env node
/**
 * Apex Executor process. PAPER read-only. Health is bound to 127.0.0.1.
 * node --experimental-strip-types services/apex-executor/src/main.ts
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import type { PaperActivation } from "./activation.ts";
import { createPaperPollClient } from "./broker.ts";
import { BROKER_POLL_INTERVAL_MS } from "./broker-poll.ts";
import type { PaperWriter } from "./broker-write.ts";
import { assertNoLiveCreds, loadPaperCredentials } from "./credentials.ts";
import { warnFileOnlyDurability } from "./persist.ts";
import { boundedSleep, createHttpPaperWriter, evidenceChannelFor, handleSupervisedInstruction, readHttpTimeoutMs } from "./production-cycle.ts";
import { Executor, PollScheduler, loadConfig } from "./runtime.ts";
import type { SupervisedOrder } from "./supervised-order.ts";

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, { "content-type": typeof body === "string" ? "text/plain" : "application/json" });
  res.end(payload);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > 65_536) throw new Error("body too large");
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export interface ServerHooks {
  writer?: PaperWriter | null;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
}

function isSupervised(value: unknown): value is SupervisedOrder {
  if (!value || typeof value !== "object") return false;
  const row = value as { orderType?: unknown; category?: unknown };
  return row.category === "SUPERVISED_PAPER_TEST" && (row.orderType === "market_notional" || row.orderType === "market_qty");
}

export function createExecutorServer(exec: Executor, token: string, hooks: ServerHooks = {}): Server {
  const now = hooks.now ?? (() => Date.now());
  const env = hooks.env ?? process.env;
  return createServer(async (req, res) => {
    if (!token || req.headers["x-executor-token"] !== token) {
      send(res, 401, "unauthorized");
      return;
    }
    try {
      if (req.method === "GET" && req.url === "/health") {
        send(res, 200, exec.health(now()));
        return;
      }
      if (req.method === "POST" && req.url === "/activation") {
        const window = JSON.parse(await readBody(req)) as PaperActivation;
        const result = exec.armPaperActivation(window, env, now());
        send(res, result.ok ? 200 : 422, result);
        return;
      }
      if (req.method === "POST" && req.url === "/instructions") {
        const raw = await readBody(req);
        let parsed: unknown = null;
        try {
          parsed = JSON.parse(raw) as unknown;
        } catch {
          parsed = null;
        }
        if (isSupervised(parsed)) {
          if (!hooks.writer) {
            send(res, 422, { accepted: false, submitted: false, reason: "PAPER adapter unavailable", orderState: null });
            return;
          }
          const writer = hooks.writer;
          const result = await handleSupervisedInstruction(exec, parsed, writer, env, now);
          send(res, result.submitted ? 202 : 422, result);
          return;
        }
        const result = exec.ingest(raw, now());
        send(res, result.accepted ? 202 : 422, result);
        return;
      }
      send(res, 404, "not found");
    } catch {
      send(res, 400, "bad request");
    }
  });
}

export interface BootOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export async function boot(env: NodeJS.ProcessEnv = process.env, opts: BootOptions = {}): Promise<{ exec: Executor; server: Server; stop: () => void }> {
  assertNoLiveCreds(env);
  const paper = loadPaperCredentials(env);
  const config = loadConfig(env);
  const exec = new Executor(config, paper);
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? (() => Date.now());
  const sleep = opts.sleep ?? boundedSleep;
  const timeoutMs = readHttpTimeoutMs(env);
  let writer: PaperWriter | null = null;
  if (paper) {
    writer = createHttpPaperWriter(fetchImpl, paper, {
      charge: (purpose) => exec.spendBudget(now(), 1, purpose),
      timeoutMs,
      sleep,
      evidenceChannel: evidenceChannelFor(fetchImpl),
    });
    exec.useEnv(env);
    exec.requireActivation();
    exec.attachActivityWriter(writer);
    exec.markStartupPending();
    await exec.recoverInFlight(writer, now, sleep);
    exec.markStartupReady();
  }
  const scheduler = new PollScheduler(config.pollIntervalMs ?? BROKER_POLL_INTERVAL_MS, async () => {
    if (!paper) {
      exec.notePoll("paper credentials not configured");
      return null;
    }
    try {
      const result = await exec.runBrokerPoll(createPaperPollClient(paper, timeoutMs, fetchImpl), now());
      return !result.ok;
    } catch {
      exec.notePoll("paper read failed");
      return true;
    }
  }, {
    setTimer(delayMs, fire) {
      return setTimeout(() => {
        void fire();
      }, delayMs);
    },
    clearTimer(handle) {
      clearTimeout(handle as ReturnType<typeof setTimeout>);
    },
  });

  await scheduler.start();

  const token = env.APEX_EXECUTOR_HEALTH_TOKEN || "";
  const port = env.APEX_EXECUTOR_PORT != null && env.APEX_EXECUTOR_PORT !== "" ? Number(env.APEX_EXECUTOR_PORT) : 8787;
  const server = createExecutorServer(exec, token, { writer, env, now });
  await new Promise<void>((resolve) => {
    server.listen(port, "127.0.0.1", () => resolve());
  });
  warnFileOnlyDurability();
  console.log(JSON.stringify({ ...exec.health(now()), port }));

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    scheduler.stop();
    server.close();
    exec.release();
  };
  return { exec, server, stop };
}

function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (invokedDirectly()) {
  boot()
    .then(({ stop }) => {
      const shutdown = () => {
        stop();
        process.exit(0);
      };
      process.on("SIGTERM", shutdown);
      process.on("SIGINT", shutdown);
      if (process.platform === "win32") process.on("SIGBREAK", shutdown);
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : "executor failed");
      process.exit(1);
    });
}
