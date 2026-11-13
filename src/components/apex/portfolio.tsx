import { exposures, instrument, quoteOf, equityCents, unrealizedCents } from "@/lib/apex/domain";
import { fmtCents, fmtMicros, fmtPct } from "@/lib/apex/money";
import { notionalCents } from "@/lib/apex/money";
import { useApex } from "@/lib/apex/session";
import { Banner, Panel } from "./ui";

export function Portfolio() {
  const { book } = useApex();
  const exp = exposures(book);
  const eq = equityCents(book);
  const open = book.positions.filter((p) => p.qtyMicros !== 0);
  return (
    <div className="space-y-4">
      <Banner tone="brass">
        Cash is an acceptable position. Allocation follows risk, not a win rate. This book does not use full Kelly, and it does not treat two equity ETFs as unrelated bets.
      </Banner>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Holdings">
          {open.length === 0 ? (
            <p className="text-sm text-muted">Flat. Equity is {fmtCents(eq)}, all in simulated cash. Unrealized {fmtCents(unrealizedCents(book))}.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-muted">
                  <tr>
                    <th className="py-2 font-medium">Instrument</th>
                    <th className="py-2 font-medium">Qty</th>
                    <th className="py-2 font-medium">Avg</th>
                    <th className="py-2 font-medium">Value</th>
                    <th className="py-2 font-medium">Strategy</th>
                  </tr>
                </thead>
                <tbody>
                  {open.map((p) => (
                    <tr key={`${p.instrumentId}-${p.strategyId}`} className="border-t border-line font-mono tabular-nums">
                      <td className="py-2">{p.instrumentId}</td>
                      <td>{(p.qtyMicros / 1_000_000).toLocaleString("en-US")}</td>
                      <td>{fmtMicros(p.avgPriceMicros)}</td>
                      <td>{fmtCents(notionalCents(quoteOf(p.instrumentId)?.lastMicros ?? 0, p.qtyMicros))}</td>
                      <td>{p.strategyId}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
        <Panel title="Factor exposure">
          {exp.byFactor.length === 0 ? (
            <p className="text-sm text-muted">No factor exposure. The 15% same-factor cap is idle.</p>
          ) : (
            <ul className="space-y-3">
              {exp.byFactor.map((row) => {
                const pct = eq > 0 ? row.grossCents / eq : 0;
                return (
                  <li key={row.key}>
                    <div className="flex justify-between text-sm">
                      <span>{row.key}</span>
                      <span className="font-mono tabular-nums">{fmtPct(pct)}</span>
                    </div>
                    <div className="mt-1 h-2 bg-surface-2">
                      <div className="h-2 bg-brass" style={{ width: `${Math.min(100, pct * 100)}%` }} />
                    </div>
                    <p className="mt-1 text-xs text-muted">Gross {fmtCents(row.grossCents)} · net {fmtCents(row.netCents)}</p>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>
      <Panel title="What is not diversification">
        <ul className="space-y-2 text-sm text-muted">
          <li>SPY and QQQ share us-equity-beta. Holding both can still be one bet. The engine rejects a same-factor add once that factor is 8% of equity.</li>
          <li>GLD is an equity-listed fund. GCZ26 is a deliverable future. They are different instruments, and only GLD is paper-eligible.</li>
          <li>{instrument("EVT-DEMO")?.notes}</li>
        </ul>
      </Panel>
    </div>
  );
}
