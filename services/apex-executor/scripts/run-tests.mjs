#!/usr/bin/env node
/**
 * Cross-platform executor tests.
 * Windows shells do not expand *.test.ts, so this passes an explicit file list.
 */
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..");
const testDir = join(here, "..", "test");
const files = readdirSync(testDir)
  .filter((name) => name.endsWith(".test.ts"))
  .sort()
  .map((name) => join(testDir, name));
if (files.length === 0) {
  console.error("no executor tests found");
  process.exit(1);
}
const run = spawnSync(process.execPath, ["--experimental-strip-types", "--test", ...files], {
  cwd: root,
  stdio: "inherit",
});
if (run.error) {
  console.error(run.error.message);
  process.exit(1);
}
process.exit(run.status === 0 ? 0 : run.status ?? 1);
