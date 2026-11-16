#!/usr/bin/env node
/**
 * Full app typecheck. Preexisting research errors are reported and do not fail.
 * Any error in a file outside that list fails the check.
 */
import { spawnSync } from "node:child_process";

const KNOWN = new Set([
  "src/lib/apex/research/costs.test.ts",
  "src/lib/apex/research/distributions.ts",
  "src/lib/apex/research/phase2.ts",
  "src/lib/apex/research/relative-strength.test.ts",
  "src/lib/apex/research/transport.test.ts",
  "src/lib/apex/research/trend-strategy.test.ts",
]);

const run = spawnSync("./node_modules/.bin/tsc", ["--noEmit", "--pretty", "false"], { encoding: "utf8" });
const text = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
const files = new Set();
for (const line of text.split("\n")) {
  const match = line.match(/^(src\/\S+?)\(/);
  if (match) files.add(match[1]);
}
const fresh = [...files].filter((file) => !KNOWN.has(file));
const preexisting = [...files].filter((file) => KNOWN.has(file));
console.log(JSON.stringify({ preexisting, fresh, tscStatus: run.status }));
if (fresh.length) process.exit(1);
process.exit(0);
