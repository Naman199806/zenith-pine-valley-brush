import { useServerFn } from "@tanstack/react-start";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { acceptanceFn, deskFn, killFn, scenarioFn, setModeFn, submitOrderFn } from "./api.ts";
import { type Book, type Intent, initialBook } from "./domain.ts";
import type { DeskReport } from "./desk.ts";
import type { Check } from "./drills.ts";

const KEY = "apex-quant-x-book-v1";

interface Session {
  book: Book;
  busy: boolean;
  desk: DeskReport | null;
  checks: Check[] | null;
  submit: (intent: Intent) => Promise<void>;
  research: () => Promise<void>;
  paper: () => Promise<void>;
  kill: (action: "block" | "cancel" | "flatten" | "release-block") => Promise<void>;
  scenario: (name: string) => Promise<void>;
  review: (caseId: string) => Promise<void>;
  runChecks: () => Promise<void>;
}

const Ctx = createContext<Session | null>(null);

export function ApexProvider({ children }: { children: ReactNode }) {
  const [book, setBook] = useState<Book>(initialBook());
  const [busy, setBusy] = useState(false);
  const [desk, setDesk] = useState<DeskReport | null>(null);
  const [checks, setChecks] = useState<Check[] | null>(null);
  const submitCall = useServerFn(submitOrderFn);
  const modeCall = useServerFn(setModeFn);
  const killCall = useServerFn(killFn);
  const scenarioCall = useServerFn(scenarioFn);
  const deskCall = useServerFn(deskFn);
  const checkCall = useServerFn(acceptanceFn);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setBook(JSON.parse(raw) as Book);
    } catch {
      /* keep the deterministic opening book */
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(book));
  }, [book]);

  async function wrap(work: () => Promise<void>) {
    setBusy(true);
    try {
      await work();
    } catch (error) {
      const message = error instanceof Error ? error.message : "The risk service rejected the request.";
      setBook((current) => ({ ...current, lastMessage: message }));
    } finally {
      setBusy(false);
    }
  }

  const api = useMemo<Session>(
    () => ({
      book,
      busy,
      desk,
      checks,
      submit: (intent) =>
        wrap(async () => {
          const result = await submitCall({ data: { book, intent } });
          setBook(result.book);
        }),
      research: () =>
        wrap(async () => {
          const result = await modeCall({ data: { book, mode: "RESEARCH" } });
          setBook(result.book);
        }),
      paper: () =>
        wrap(async () => {
          const result = await modeCall({ data: { book, mode: "PAPER" } });
          setBook(result.book);
        }),
      kill: (action) =>
        wrap(async () => {
          const result = await killCall({ data: { book, action } });
          setBook(result.book);
        }),
      scenario: (name) =>
        wrap(async () => {
          setBook(await scenarioCall({ data: name }));
        }),
      review: (caseId) =>
        wrap(async () => {
          setDesk(await deskCall({ data: { book, caseId } }));
        }),
      runChecks: () =>
        wrap(async () => {
          const report = await checkCall({ data: { confirm: true } });
          setChecks(report.checks);
        }),
    }),
    [book, busy, desk, checks, submitCall, modeCall, killCall, scenarioCall, deskCall, checkCall],
  );

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useApex(): Session {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("Session missing");
  return ctx;
}
