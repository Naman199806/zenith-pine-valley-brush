import { AGENT_ROSTER } from "@/lib/apex/desk";
import { ROLE_STATUS } from "@/lib/apex/research/role-status";
import { Banner, Panel } from "./ui";

const BOUNDARY = [
  "No agent has a broker tool.",
  "No agent can raise a limit, turn on live mode, or rewrite a strategy version.",
  "Prices, balances, and fills come from the ledger and the fixture. A narrative that disagrees is discarded.",
  "Retrieved pages and posts are untrusted. They are not wired into this build.",
  "Model cost on this desk is zero. The notes are deterministic rules, not a sampled model.",
];

export function Agents() {
  return (
    <div className="space-y-4">
      <Banner>
        Twelve roles, one boundary. The risk officer can argue. The risk engine decides. Hermes-style scheduling and TradingAgents-style debate are specified as future isolated services. They are not running here, and they would still not be allowed to send orders.
      </Banner>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {AGENT_ROSTER.map(([id, name], index) => {
          const row = ROLE_STATUS.find((role) => role.id === id);
          return (
            <article key={id} className="border border-line bg-surface p-4">
              <p className="font-mono text-xs text-brass">{String(index + 1).padStart(2, "0")} · {row?.status ?? "UNAVAILABLE"}</p>
              <h2 className="mt-1 text-sm">{name}</h2>
              <p className="mt-2 text-sm text-muted">{row?.note ?? "Idle. No model call."}</p>
            </article>
          );
        })}
      </div>
      <Panel title="Hard boundary">
        <ul className="space-y-2 text-sm">
          {BOUNDARY.map((line) => (
            <li key={line} className="text-muted">{line}</li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
