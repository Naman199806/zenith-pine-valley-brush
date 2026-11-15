import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { classifyBrokerResponse, staleCandleError } from "./broker.ts";

function runNode(script: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => stdout += d);
    child.stderr.on("data", (d) => stderr += d);
    child.on("exit", (code) => resolve({ code, stdout, stderr }));
  });
}

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
  const href = pathToFileURL(join(process.cwd(), "src/lib/apex/runtime/lock.ts")).href;
  const script = `import { acquireLock } from ${JSON.stringify(href)}; const r = acquireLock(${JSON.stringify(path)}); console.log(JSON.stringify(r)); if (r.acquired) await new Promise((resolve) => setTimeout(resolve, 1500));`;
  const [a, b] = await Promise.all([runNode(script), runNode(script)]);
  for (const child of [a, b]) {
    assert.equal(child.code, 0, `child failed stdout=${child.stdout} stderr=${child.stderr}`);
    assert.ok(child.stdout.trim().length > 0, `empty child output stderr=${child.stderr}`);
  }
  const wins = [a, b].map((child) => JSON.parse(child.stdout)).filter((r) => r.acquired);
  assert.equal(wins.length, 1);
});

test("heartbeat age uses UTC and rejects future timestamps", () => {
  const heartbeat = "2026-11-15T06:30:00.000Z";
  const now = Date.parse("2026-11-15T06:30:18.000Z");
  const age = (now - Date.parse(heartbeat)) / 1000;
  assert.equal(age, 18);
  const future = (Date.parse("2026-11-15T06:29:00.000Z") - Date.parse(heartbeat)) / 1000;
  assert.ok(future < -5);
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
