import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { researchContributionFn, labResultsFn } from "@/lib/apex/api";
import { CONTROL } from "@/lib/apex/backtest";
import { STRATEGIES, type StrategyDefinition } from "@/lib/apex/domain";
import { fmtCents, fmtNum, fmtPct } from "@/lib/apex/money";
import { SPRINT3 } from "@/lib/apex/sprint3";
import { HISTORY_STATUS } from "@/lib/apex/history/status";
import { promote } from "@/lib/apex/trading";
import { Banner, Panel, Pill } from "./ui";

export function Lab() {
  const [id, setId] = useState("orb-cost-control");
  const selected = STRATEGIES.find((s) => s.id === id) ?? STRATEGIES[0]!;
  const gate = promote(selected.id, "VALIDATED");
  const loadScan = useServerFn(researchContributionFn);
  const loadLab = useServerFn(labResultsFn);
  const [scan, setScan] = useState<Awaited<ReturnType<typeof loadScan>> | null>(null);
  const [lab, setLab] = useState<Awaited<ReturnType<typeof loadLab>> | null>(null);
  useEffect(() => {
    void loadScan().then(setScan).catch(() => setScan(null));
    void loadLab().then(setLab).catch(() => setLab(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="space-y-4">
      <Banner tone="loss">
        Sprint 1 was stopped before validation: not live-feasible on free data, negative in development and replication. Sprint 2: S1 lost to costs, S2 faded after publication. Those figures were not in the recoverable bundle and are not rebuilt here. Sprint 3 is still an idea. The table below is coverage, not a return. T1 and T2 were not rescored.
      </Banner>
      <Panel title="Engine results" kicker="Consumed by Strategy Lab">
        <p className="text-sm text-muted">These are research runs on real public data. They are not validated and not paper-auto eligible. The opening-range cost loss is unchanged.</p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <article className="border border-line p-3 text-sm">
            <p className="font-mono text-xs text-brass">Backtrader · SPY · SMA 20/50</p>
            {lab?.backtrader ? (
              <p className="mt-2 text-muted">
                {lab.backtrader.coverage?.first} to {lab.backtrader.coverage?.last}. Trades {lab.backtrader.metrics?.tradeCount}. Closed PnL {lab.backtrader.metrics?.closedTradePnl}. Equity change {lab.backtrader.metrics?.equityChange}. Buy-and-hold return {lab.backtrader.metrics?.buyAndHoldReturn}. Not validated.
              </p>
            ) : (
              <p className="mt-2 text-muted">No Backtrader equity run yet.</p>
            )}
          </article>
          <article className="border border-line p-3 text-sm">
            <p className="font-mono text-xs text-brass">Freqtrade env · BTC-USD · SMA 10/30</p>
            {lab?.freqtrade ? (
              <p className="mt-2 text-muted">
                Trades {lab.freqtrade.metrics?.tradeCount}. Net {lab.freqtrade.metrics?.netPnl}. Return {lab.freqtrade.metrics?.netReturn}. Native trading disabled. Not validated.
              </p>
            ) : (
              <p className="mt-2 text-muted">No Freqtrade crypto run yet.</p>
            )}
          </article>
        </div>
      </Panel>
      <Panel title="Day-trader plan" kicker="Not a strategy promotion">
        <p className="text-sm text-muted">{scan?.note ?? "No offline plan loaded."}</p>
        {scan ? (
          <p className="mt-2 text-sm">
            Verdict {scan.riskVerdict ?? "none"}. Entry {scan.plan?.entry ?? "n/a"}, stop {scan.plan?.stop ?? "n/a"}, target {scan.plan?.target ?? "n/a"}. This does not change a registry state and cannot arm paper-auto.
          </p>
        ) : null}
      </Panel>
      <div className="grid gap-4 xl:grid-cols-[1fr_20rem]">
        <div className="overflow-x-auto border border-line">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead className="bg-surface text-xs text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Strategy</th>
                <th className="px-3 py-2 font-medium">State</th>
                <th className="px-3 py-2 font-medium">Evidence</th>
              </tr>
            </thead>
            <tbody>
              {STRATEGIES.map((s) => (
                <tr key={s.id} className="cursor-pointer border-t border-line" onClick={() => setId(s.id)}>
                  <td className="px-3 py-3">
                    <div>{s.name}</div>
                    <div className="text-xs text-muted">{s.markets}</div>
                  </td>
                  <td className="px-3 py-3 font-mono text-xs">{s.state}</td>
                  <td className="px-3 py-3 text-muted">{s.evidence}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <StrategyCard strategy={selected} blocked={gate.reasons[0] ?? "Blocked"} />
      </div>
      <DataCheck />
      <Panel title="Opening-range cost control" kicker={CONTROL.base.dataset}>
        <p className="mb-3 text-sm text-muted">{CONTROL.base.label} {CONTROL.base.notes[0]}</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] text-left text-sm">
            <thead className="text-xs text-muted">
              <tr>
                <th className="py-2 font-medium">Cost / side</th>
                <th className="py-2 font-medium">Net return</th>
                <th className="py-2 font-medium">Ending equity</th>
                <th className="py-2 font-medium">Trades</th>
                <th className="py-2 font-medium">Profit factor</th>
                <th className="py-2 font-medium">Max DD</th>
              </tr>
            </thead>
            <tbody>
              {[CONTROL.zero, CONTROL.base, CONTROL.stress].map((run) => (
                <tr key={run.id} className="border-t border-line font-mono tabular-nums">
                  <td className="py-2">{run.costBpsPerSide} bps</td>
                  <td className={run.metrics.netReturn < 0 ? "text-loss" : "text-gain"}>{fmtPct(run.metrics.netReturn)}</td>
                  <td>{fmtCents(run.endingCents)}</td>
                  <td>{run.metrics.trades}</td>
                  <td>{Number.isFinite(run.metrics.profitFactor) ? fmtNum(run.metrics.profitFactor) : "no losses"}</td>
                  <td>{fmtPct(run.metrics.maxDrawdown)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="mt-3 space-y-1 text-sm text-muted">
          {CONTROL.base.folds.map((fold) => (
            <li key={fold.name}>
              {fold.name}: {fmtPct(fold.netReturn)} over {fold.trades} trades. Same sign in every fold because the path does not change.
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

function StrategyCard({ strategy, blocked }: { strategy: StrategyDefinition; blocked: string }) {
  return (
    <aside className="border border-line bg-surface p-4 text-sm">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base">{strategy.name}</h2>
        <Pill tone={strategy.state === "RETIRED" ? "loss" : strategy.state === "PAPER" ? "brass" : "muted"}>{strategy.state}</Pill>
      </div>
      <dl className="mt-3 space-y-2 text-muted">
        <div><dt className="text-fg">Hypothesis</dt><dd>{strategy.hypothesis}</dd></div>
        <div><dt className="text-fg">Entry</dt><dd>{strategy.entry}</dd></div>
        <div><dt className="text-fg">Exit</dt><dd>{strategy.exit}</dd></div>
        <div><dt className="text-fg">Costs</dt><dd>{strategy.costModel}</dd></div>
        <div><dt className="text-fg">Failure</dt><dd>{strategy.failureModes}</dd></div>
        <div><dt className="text-fg">Retirement</dt><dd>{strategy.retirement}</dd></div>
      </dl>
      <p className="mt-3 border-t border-line pt-3 text-loss">Promotion blocked. {blocked}</p>
    </aside>
  );
}

function DataCheck() {
  return (
    <Panel title="Sprint 3 data check" kicker="Unfrozen · not scored">
      <p className="mb-3 text-sm text-muted">
        Yahoo daily bars as of {HISTORY_STATUS.fetchedUtc}. With BIL, T1 can start {SPRINT3.t1CommonStartWithBil}. T2 can start {SPRINT3.t2CommonStart}. Adjusted close is not a signal. A second daily price source is {HISTORY_STATUS.secondSource}. This table is coverage, not a return.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] text-left text-sm">
          <thead className="text-xs text-muted">
            <tr>
              <th className="py-2 font-medium">Symbol</th>
              <th className="py-2 font-medium">Role</th>
              <th className="py-2 font-medium">First bar</th>
              <th className="py-2 font-medium">Daily bars</th>
              <th className="py-2 font-medium">Dividends</th>
              <th className="py-2 font-medium">Splits</th>
            </tr>
          </thead>
          <tbody>
            {SPRINT3.rows.map((row) => (
              <tr key={row.symbol} className="border-t border-line font-mono tabular-nums">
                <td className="py-2">{row.symbol}</td>
                <td className="py-2 font-sans text-muted">{row.role}</td>
                <td className="py-2">{row.first}</td>
                <td className="py-2">{row.bars.toLocaleString("en-US")}</td>
                <td className="py-2">{row.dividends}</td>
                <td className="py-2">{row.splits}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="mt-3 space-y-2 text-sm text-muted">
        {SPRINT3.blockers.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </Panel>
  );
}
