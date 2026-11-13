import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const pidFile = join(process.cwd(), ".grok", "paper.pid");
if (!existsSync(pidFile)) {
  console.log("[paper] no monitor process is recorded.");
  process.exit(0);
}
const pid = Number(readFileSync(pidFile, "utf8"));
try {
  process.kill(pid, "SIGTERM");
  console.log(`[paper] sent SIGTERM to ${pid}. This does not flatten positions.`);
} catch (error) {
  const message = error instanceof Error ? error.message : "kill failed";
  console.log(`[paper] could not signal ${pid}: ${message}`);
}
rmSync(pidFile, { force: true });
