#!/usr/bin/env node
/**
 * Apex Executor startup. PAPER read-only. Does not submit.
 * node --experimental-strip-types services/apex-executor/src/main.ts
 */
import { createServer } from "node:http";
import { loadConfig, Executor, assertNoLiveCreds } from "./runtime.ts";

assertNoLiveCreds(process.env);
const config = loadConfig();
const exec = new Executor(config, null);
const port = Number(process.env.APEX_EXECUTOR_PORT || 8787);
const token = process.env.APEX_EXECUTOR_HEALTH_TOKEN || "";

createServer((req, res) => {
  if (req.url === "/health" && req.headers["x-executor-token"] === token && token) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(exec.health()));
    return;
  }
  res.writeHead(401);
  res.end("unauthorized");
}).listen(port, "127.0.0.1", () => {
  console.log(JSON.stringify({ service: "apex-executor", mode: config.mode, postEnabled: false, port, host: "127.0.0.1" }));
});
