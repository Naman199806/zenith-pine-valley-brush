#!/usr/bin/env node
/**
 * Strict typecheck of the executor sources.
 * File list is explicit so Windows shells do not have to expand *.ts.
 */
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..");
const files = readdirSync(join(here, "..", "src"))
  .filter((name) => name.endsWith(".ts") && !name.endsWith(".d.ts"))
  .sort()
  .map((name) => `services/apex-executor/src/${name}`);
const require = createRequire(import.meta.url);
const tsc = join(dirname(require.resolve("typescript/package.json")), "bin", "tsc");
const run = spawnSync(process.execPath, [
  tsc,
  "--noEmit",
  "--pretty",
  "false",
  "--strict",
  "--target",
  "ES2022",
  "--module",
  "ESNext",
  "--moduleResolution",
  "bundler",
  "--allowImportingTsExtensions",
  "--skipLibCheck",
  "--types",
  "node",
  ...files,
], { cwd: root, encoding: "utf8" });
if (run.error) {
  console.error(run.error.message);
  process.exit(1);
}
process.stdout.write(run.stdout ?? "");
process.stderr.write(run.stderr ?? "");
process.exit(run.status === 0 ? 0 : run.status ?? 1);
