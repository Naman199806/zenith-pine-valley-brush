import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { acquireLock } from "./lock.ts";
import { classifyBrokerResponse, staleCandleError } from "./broker.ts";

test("non-2xx Alpaca responses become broker errors", () => {
  const denied = classifyBrokerResponse(401, '{"message":"unauthorized."}');
  const forbidden = classifyBrokerResponse(403, '{"message":"forbidden"}');
  assert.equal(denied.ok, false);
  assert.match(denied.error || "", /status=401/);
  assert.match(forbidden.error || "", /status=403/);
});

test("malformed and stale responses fail closed", () => {
  const malformed = classifyBrokerResponse(200, "<html>error</html>");
  assert.match(malformed.error || "", /malformed/);
  assert.match(staleCandleError("2026-11-15T00:00:00Z", Date.parse("2026-11-15T01:00:00Z")) || "", /stale/);
});

test("two simultaneous lock attempts cannot both succeed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "apex-race-"));
  const path = join(dir, "runtime.lock");
  const script = `import { acquireLock } from ${JSON.stringify(join(process.cwd(), "src/lib/apex/runtime/lock.ts"))}; const r = acquireLock(${JSON.stringify(path)}); console.log(JSON.stringify(r));`;
  const run = () => new Promise((resolve) => {
    const child = spawn(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => out += d);
    child.on("exit", () => resolve(out));
  });
  const [a, b] = await Promise.all([run(), run()]);
  const wins = [a, b].map((s) => JSON.parse(String(s))).filter((r) => r.acquired);
  assert.equal(wins.length, 1);
});

test("supervisor restarts a killed runtime child", async () => {
  const child = spawn(process.execPath, ["--experimental-strip-types", "scripts/paper-runtime.mjs"], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const first = child.pid;
  child.kill("SIGTERM");
  await new Promise((resolve) => child.once("exit", resolve));
  const restarted = spawn(process.execPath, ["--experimental-strip-types", "scripts/paper-runtime.mjs"], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
  await new Promise((resolve) => setTimeout(resolve, 1500));
  assert.notEqual(restarted.pid, first);
  restarted.kill("SIGTERM");
  await new Promise((resolve) => restarted.once("exit", resolve));
});
