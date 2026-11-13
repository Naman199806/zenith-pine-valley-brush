import { expiryStatus } from "@/lib/apex/desk";
import { useApex } from "@/lib/apex/session";
import { Banner, Button, Panel } from "./ui";

const FRAMEWORKS = [
  ["QuantConnect LEAN", "See Integrations", "Apache-2.0. Status is the last launcher run, not this card. The 3-bar check is still not LEAN."],
  ["TradingAgents", "See Integrations", "Apache-2.0. A model rating is a hypothesis, not an order."],
  ["Hermes Agent", "See Integrations", "MIT. It cannot approve itself or write risk limits."],
  ["Freqtrade", "See Integrations", "GPL-3.0-only. Isolated backtest only. Not vendored. Not legal clearance."],
  ["Backtrader", "See Integrations", "GPL-3.0-or-later. Two fixture checks. Not a second ledger."],
  ["Day Trader Skill", "See Integrations", "MIT at 3d0f4ef. Offline scan and a blocked risk check. Not evidence of profitability."],
];

const SCENARIOS = [
  ["reset", "Reset"],
  ["paper", "Paper session"],
  ["correlated", "Long SPY"],
  ["daily-loss", "Daily loss"],
  ["stale", "Stale quotes"],
  ["mismatch", "Broken reconcile"],
  ["open-risk", "Flatten while down"],
] as const;

export function Ops() {
  const { busy, checks, runChecks, scenario } = useApex();
  const failed = checks?.filter((c) => !c.passed).length ?? 0;
  return (
    <div className="space-y-4">
      <Banner>
        Paper trading is a separate Alpaca path and starts in monitoring. Live trading is not implemented. The framework list on this page is not the measured status. Open Integrations for the process that actually ran.
      </Banner>
      <Panel
        title="Acceptance checks"
        kicker="Same functions as the test suite"
        action={<Button tone="brass" disabled={busy} onClick={() => void runChecks()}>Run checks</Button>}
      >
        {checks ? (
          <p className="mb-3 text-sm">{checks.length - failed} passed, {failed} failed.</p>
        ) : (
          <p className="mb-3 text-sm text-muted">Not run in this session. The engine tests cover the same checks.</p>
        )}
        <ul className="max-h-80 space-y-2 overflow-auto">
          {(checks ?? []).map((c) => (
            <li key={c.id} className="grid gap-1 border-b border-line pb-2 text-sm md:grid-cols-[10rem_1fr]">
              <span className={c.passed ? "text-gain" : "text-loss"}>{c.passed ? "pass" : "fail"} · {c.id}</span>
              <span className="text-muted">{c.detail}</span>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="Failure drills">
        <div className="flex flex-wrap gap-2">
          {SCENARIOS.map(([id, label]) => (
            <Button key={id} disabled={busy} onClick={() => void scenario(id)}>{label}</Button>
          ))}
        </div>
        <p className="mt-3 text-sm text-muted">Loading a scenario replaces the simulated book. It does not touch a broker, because none is connected.</p>
      </Panel>
      <Panel title="Contract expiries">
        <ul className="space-y-2 text-sm">
          {expiryStatus().map((row) => (
            <li key={row.id} className={row.warn ? "text-warn" : "text-muted"}>{row.detail}</li>
          ))}
        </ul>
      </Panel>
      <Panel title="Upstream frameworks">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead className="text-xs text-muted">
              <tr>
                <th className="py-2 font-medium">Project</th>
                <th className="py-2 font-medium">State</th>
                <th className="py-2 font-medium">Decision</th>
              </tr>
            </thead>
            <tbody>
              {FRAMEWORKS.map((row) => (
                <tr key={row[0]} className="border-t border-line">
                  <td className="py-3">{row[0]}</td>
                  <td className="py-3 text-warn">{row[1]}</td>
                  <td className="py-3 text-muted">{row[2]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
