import { Line, LineChart, ResponsiveContainer, Tooltip, YAxis } from "recharts";
import { CONTROL } from "@/lib/apex/backtest";
import { STRATEGIES, dailyPnlCents, drawdown, equityCents, exposures, realizedCents, unrealizedCents } from "@/lib/apex/domain";
import { fmtCents, fmtNum, fmtPct } from "@/lib/apex/money";
import { useApex } from "@/lib/apex/session";
import { Banner, Panel, Stat } from "./ui";
import { PaperPanel } from "./paper";
import { DryRunPanel } from "./dryrun";

export function Overview() {
  const { book } = useApex();
  const eq = equityCents(book);
  const pnl = dailyPnlCents(book);
  const exp = exposures(book);
  const counts = STRATEGIES.reduce<Record<string, number>>((acc, s) => {
    acc[s.state] = (acc[s.state] ?? 0) + 1;
    return acc;
  }, {});
  return (
    <div className="space-y-4">
      <PaperPanel />
      <DryRunPanel />
      <Banner>
        The book below is an internal fixture, not a broker. Alpaca paper is the separate panel. It stays blank until the paper host authenticates. Live trading is not implemented. Sprint 1 and 2 stay retired. Sprint 3 has not been scored. The opening-range loss is unchanged.
      </Banner>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Simulated equity" value={fmtCents(eq)} hint="Cash plus fixture marks" />
        <Stat label="Day P&L" value={fmtCents(pnl)} tone={pnl < 0 ? "loss" : pnl > 0 ? "gain" : "fg"} hint="Against the session open" />
        <Stat label="Drawdown from peak" value={fmtPct(drawdown(book))} tone={drawdown(book) >= 0.05 ? "warn" : "fg"} hint="Review at 5%. Block new risk at 8%." />
        <Stat label="Gross exposure" value={fmtCents(exp.grossCents)} hint={`Net ${fmtCents(exp.netCents)}`} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Cost control, not the book" kicker="Illustrative path" >
          <p className="mb-3 text-sm text-muted">
            Forty identical sessions. A 4 cent continuation against 8 bps a side. Net return {fmtPct(CONTROL.base.metrics.netReturn)}. Sharpe is {fmtNum(CONTROL.base.metrics.sharpe)} because variance is zero.
          </p>
          <div className="h-48 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={CONTROL.base.equity}>
                <YAxis hide domain={["dataMin", "dataMax"]} />
                <Tooltip
                  formatter={(value) => fmtCents(Number(value))}
                  labelFormatter={() => "Constructed session"}
                  contentStyle={{ background: "var(--color-surface)", border: "1px solid var(--color-line)", color: "var(--color-fg)" }}
                />
                <Line type="stepAfter" dataKey="equityCents" stroke="var(--color-loss)" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <div className="space-y-4">
          <Panel title="Book" kicker={book.mode}>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <Row label="Cash" value={fmtCents(book.cashCents)} />
              <Row label="Realized" value={fmtCents(realizedCents(book))} />
              <Row label="Unrealized" value={fmtCents(unrealizedCents(book))} />
              <Row label="Open positions" value={String(book.positions.filter((p) => p.qtyMicros !== 0).length)} />
              <Row label="Orders" value={String(book.orders.length)} />
              <Row label="Data" value={book.dataStatus} />
              <Row label="Reconcile" value={book.reconciliation} />
              <Row label="Kill" value={book.kill.blockNew ? "Blocking new risk" : "Open"} />
            </dl>
          </Panel>
          <Panel title="Registry">
            <ul className="flex flex-wrap gap-2">
              {Object.entries(counts).map(([state, n]) => (
                <li key={state} className="border border-line px-2 py-1 font-mono text-xs text-muted">
                  {state} {n}
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
      <Panel title="Audit">
        <ul className="space-y-2">
          {book.audits.slice(-6).reverse().map((event) => (
            <li key={event.id} className="grid gap-1 border-b border-line pb-2 text-sm md:grid-cols-[11rem_9rem_1fr]">
              <span className="font-mono text-xs text-muted">{event.ts.slice(11, 19)} UTC</span>
              <span className="text-brass">{event.action}</span>
              <span className="text-muted">{event.detail}</span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="font-mono tabular-nums">{value}</dd>
    </div>
  );
}
