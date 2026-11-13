import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { researchContributionFn, workflowFn } from "@/lib/apex/api";
import { runDesk } from "@/lib/apex/desk";
import { sizingPreview } from "@/lib/apex/trading";
import { useApex } from "@/lib/apex/session";
import { Banner, Button, Panel, Pill } from "./ui";

const CASES = [
  { id: "mechanics", label: "SPY plumbing" },
  { id: "correlated", label: "QQQ on SPY" },
  { id: "futures", label: "MES future" },
  { id: "prediction", label: "Event contract" },
  { id: "crypto-arb", label: "Crypto gap" },
  { id: "conflict", label: "Bull versus bear" },
] as const;

export function Research() {
  const { book, busy, review, desk, submit } = useApex();
  const [localId, setLocalId] = useState("mechanics");
  const report = desk && desk.caseId === localId ? desk : runDesk(book, localId);
  const loadScan = useServerFn(researchContributionFn);
  const loadWorkflow = useServerFn(workflowFn);
  const [scan, setScan] = useState<Awaited<ReturnType<typeof loadScan>> | null>(null);
  const [workflow, setWorkflow] = useState<Awaited<ReturnType<typeof loadWorkflow>> | null>(null);
  useEffect(() => {
    void loadScan().then(setScan).catch(() => setScan(null));
    void loadWorkflow().then(setWorkflow).catch(() => setWorkflow(null));
    // One read. It does not submit an order.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="space-y-4">
      <Banner tone="brass">
        Agents argue from timestamped evidence. They cannot send an order. The risk engine’s decision is the one that counts, and a missing or stale input blocks the ticket.
      </Banner>
      <Panel title="Framework adapters" kicker={workflow ? "Consumed by Research" : "Loading"}>
        <p className="text-sm text-muted">
          {workflow
            ? `Adapters invoked. executable=${String(workflow.executable)}. paper-auto=${String(workflow.paperAutoEligible)}. Proposal accepted=${String(workflow.proposalAccepted)}.`
            : "Workflow adapters have not been read."}
        </p>
        {workflow ? (
          <ul className="mt-2 space-y-1 font-mono text-xs text-muted">
            {Object.entries(workflow.adapters).map(([id, status]) => (
              <li key={id}>{id}: {status}</li>
            ))}
          </ul>
        ) : null}
        {workflow?.proposalReasons.length ? (
          <p className="mt-2 text-sm text-muted">{workflow.proposalReasons.join(" ")}</p>
        ) : null}
      </Panel>
      <Panel title="Day-trader scan" kicker="Offline fixture">
        <p className="text-sm text-muted">{scan?.note ?? "The offline scan has not been loaded."}</p>
        {scan?.plan ? (
          <p className="mt-2 text-sm">
            Plan entry {scan.plan.entry} stop {scan.plan.stop} target {scan.plan.target}. Risk verdict {scan.riskVerdict ?? "none"}. Broker invoked: {scan.brokerInvoked ? "yes" : "no"}. Paper-auto: no.
          </p>
        ) : null}
        {scan?.riskReasons?.length ? (
          <ul className="mt-2 space-y-1 text-sm text-muted">
            {scan.riskReasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        ) : null}
      </Panel>
      <div className="flex flex-wrap gap-2">
        {CASES.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`px-3 py-2 text-sm ${localId === c.id ? "bg-brass text-brass-ink" : "border border-line"}`}
            onClick={() => {
              setLocalId(c.id);
              void review(c.id);
            }}
          >
            {c.label}
          </button>
        ))}
      </div>
      <Panel title={report.title} kicker="Desk" action={<Pill tone={report.blocked ? "loss" : "brass"}>{report.blocked ? "Blocked" : "Engine approved"}</Pill>}>
        <p className="text-sm">{report.rankNote}</p>
        <ul className="mt-3 space-y-1 text-sm text-muted">
          {report.blockReasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
        {report.intent && report.risk?.approved ? (
          <div className="mt-3">
            <Button
              tone="brass"
              disabled={busy || book.mode !== "PAPER"}
              onClick={() => void submit(report.caseId === "mechanics" ? sizingPreview(book, "SPY") : report.intent!)}
            >
              Send to execution service
            </Button>
          </div>
        ) : null}
      </Panel>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {report.agents.map((agent) => (
          <article key={agent.id} className="border border-line bg-surface p-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm">{agent.name}</h3>
              <Pill tone={agent.stance === "block" || agent.stance === "oppose" ? "loss" : agent.stance === "support" ? "gain" : "muted"}>{agent.stance}</Pill>
            </div>
            <p className="mt-2 text-sm text-muted">{agent.text}</p>
          </article>
        ))}
      </div>
      <Panel title="Evidence">
        <ul className="space-y-2 text-sm">
          {report.evidence.map((item) => (
            <li key={item.id}>
              <span className="font-mono text-xs text-brass">{item.id}</span>
              <span className="text-muted"> · {item.source} · {item.ts}</span>
              <p>{item.text}</p>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
