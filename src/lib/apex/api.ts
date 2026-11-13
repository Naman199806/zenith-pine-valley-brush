import { createServerFn } from "@tanstack/react-start";
import type { Book, Intent, OperatingMode } from "./domain.ts";
import { runAcceptance } from "./drills.ts";
import { runDesk } from "./desk.ts";
import { applySubmission, loadScenario, setKill, setMode } from "./trading.ts";

const SCENARIOS = ["reset", "paper", "correlated", "daily-loss", "stale", "mismatch", "open-risk"] as const;

function asBook(book: Book): Book {
  if (!book || book.liveLocked !== true) throw new Error("Book is missing the live lock.");
  if (!Array.isArray(book.orders) || !Array.isArray(book.positions) || !Array.isArray(book.audits)) {
    throw new Error("Book is incomplete.");
  }
  if (book.mode !== "RESEARCH" && book.mode !== "PAPER" && book.mode !== "LIVE") throw new Error("Bad mode.");
  return book;
}

export const submitOrderFn = createServerFn({ method: "POST" })
  .validator((input: { book: Book; intent: Intent }) => {
    asBook(input?.book);
    if (!input.intent?.idempotencyKey || !input.intent.instrumentId) throw new Error("Incomplete order.");
    return input;
  })
  .handler(async ({ data }) => applySubmission(data.book, data.intent));

export const setModeFn = createServerFn({ method: "POST" })
  .validator((input: { book: Book; mode: OperatingMode }) => {
    asBook(input?.book);
    if (input.mode !== "RESEARCH" && input.mode !== "PAPER" && input.mode !== "LIVE") throw new Error("Bad mode.");
    return input;
  })
  .handler(async ({ data }) => setMode(data.book, data.mode));

export const killFn = createServerFn({ method: "POST" })
  .validator((input: { book: Book; action: "block" | "cancel" | "flatten" | "release-block" }) => {
    asBook(input?.book);
    return input;
  })
  .handler(async ({ data }) => setKill(data.book, data.action));

export const scenarioFn = createServerFn({ method: "POST" })
  .validator((name: string) => {
    if (!SCENARIOS.includes(name as (typeof SCENARIOS)[number])) throw new Error("Unknown scenario.");
    return name;
  })
  .handler(async ({ data }) => loadScenario(data));

export const acceptanceFn = createServerFn({ method: "POST" })
  .validator((input: { confirm: boolean }) => input)
  .handler(async () => runAcceptance());

export const deskFn = createServerFn({ method: "POST" })
  .validator((input: { book: Book; caseId: string }) => {
    asBook(input?.book);
    if (!input.caseId) throw new Error("Missing case.");
    return input;
  })
  .handler(async ({ data }) => runDesk(data.book, data.caseId));

export const integrationsFn = createServerFn({ method: "POST" })
  .handler(async () => {
    const { integrationHealth } = await import("./integrations/registry.server.ts");
    return integrationHealth();
  });

export const labResultsFn = createServerFn({ method: "POST" })
  .handler(async () => {
    const { readFileSync, existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    const root = process.cwd();
    const load = (name: string) => {
      const path = join(root, "research", "lab", name);
      if (!existsSync(path)) return null;
      return JSON.parse(readFileSync(path, "utf8"));
    };
    return { backtrader: load("backtrader-spy.json"), freqtrade: load("freqtrade-btc.json") };
  });

export const workflowFn = createServerFn({ method: "POST" })
  .handler(async () => {
    const { runUnifiedWorkflow } = await import("./integrations/workflow.ts");
    return runUnifiedWorkflow();
  });

export const researchContributionFn = createServerFn({ method: "POST" })
  .handler(async () => {
    const { researchContribution } = await import("./integrations/registry.server.ts");
    return researchContribution();
  });

export const paperDeskFn = createServerFn({ method: "POST" })
  .validator((input: { refresh?: boolean } | undefined) => input ?? {})
  .handler(async () => {
    const { readPaperDesk } = await import("./broker/runtime.server.ts");
    return readPaperDesk();
  });

export const paperActionFn = createServerFn({ method: "POST" })
  .validator((input: { action: string; symbol?: string; operatorConfirmed?: boolean; phrase?: string; keyId?: string; secret?: string }) => {
    const allowed = ["refresh", "disarm", "emergency", "arm-manual", "approve-auto", "confirm-entry", "store-keys", "propose-entry", "propose-smoke", "cancel", "reconcile"];
    if (!input || !allowed.includes(input.action)) throw new Error("Unknown paper action.");
    if (input.action === "confirm-entry" && input.operatorConfirmed !== true) throw new Error("Operator confirmation is required.");
    if (input.action === "store-keys" && (typeof input.keyId !== "string" || typeof input.secret !== "string")) {
      throw new Error("Both the paper key ID and the paper secret are required.");
    }
    return input;
  })
  .handler(async ({ data }) => {
    const { paperAction, readPaperDesk } = await import("./broker/runtime.server.ts");
    if (data.action === "refresh") return readPaperDesk();
    return paperAction(data.action, data);
  });

export const dryRunFn = createServerFn({ method: "POST" })
  .handler(async () => {
    const { readDryRun } = await import("./broker/dryrun.server.ts");
    return readDryRun();
  });
