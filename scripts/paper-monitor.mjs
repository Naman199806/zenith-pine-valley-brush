import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { openPaperStreams, paperStreamCredentials, readPaperDesk } from "../src/lib/apex/broker/runtime.server.ts";

const dir = join(process.cwd(), ".grok");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "paper.pid"), String(process.pid));

const stop = new AbortController();
process.on("SIGTERM", () => stop.abort());
process.on("SIGINT", () => stop.abort());

const creds = paperStreamCredentials();

if (!creds) {
  console.log("[paper] IDLE. No paper key is stored, so this process will not poll Alpaca.");
  process.exit(0);
}

if (creds) {
  void openPaperStreams(creds, (text) => {
    console.log(`[paper] ${text}`);
  }, stop.signal);
}

console.log("[paper] MONITORING. This process does not submit orders. Live trading is not implemented.");

while (!stop.signal.aborted) {
  const desk = await readPaperDesk();
  console.log(`[paper] connected=${desk.connected} mode=${desk.launchMode} reason=${desk.reason}`);
  await new Promise((resolve) => setTimeout(resolve, 20_000));
}

console.log("[paper] stopped. Positions were not liquidated.");
