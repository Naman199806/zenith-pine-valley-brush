import { useState } from "react";
import { INSTRUMENTS, QUOTES, type AssetClass } from "@/lib/apex/domain";
import { fmtMicros } from "@/lib/apex/money";
import { Banner, Pill } from "./ui";

const FILTERS: Array<AssetClass | "all"> = ["all", "etf", "crypto", "fx", "option", "future", "prediction", "commodity"];

export function Markets() {
  const [filter, setFilter] = useState<AssetClass | "all">("all");
  const [picked, setPicked] = useState("SPY");
  const rows = INSTRUMENTS.filter((i) => filter === "all" || i.assetClass === filter || (filter === "commodity" && (i.id === "GLD" || i.id === "DBC" || i.id === "GCZ26" || i.id === "CLZ26")));
  const inst = INSTRUMENTS.find((i) => i.id === picked) ?? INSTRUMENTS[0]!;
  const quote = QUOTES[inst.id];
  return (
    <div className="space-y-4">
      <Banner>Every row is a model or a fixture. Delayed and live vendor feeds are not connected. A green price would be a lie, so these are labeled.</Banner>
      <div className="flex gap-2 overflow-x-auto">
        {FILTERS.map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)} className={`px-3 py-2 text-sm ${filter === f ? "bg-brass text-brass-ink" : "border border-line text-muted"}`}>
            {f}
          </button>
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-[1fr_18rem]">
        <div className="overflow-x-auto border border-line">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="bg-surface text-xs text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Symbol</th>
                <th className="px-3 py-2 font-medium">Class</th>
                <th className="px-3 py-2 font-medium">Venue</th>
                <th className="px-3 py-2 font-medium">Fixture</th>
                <th className="px-3 py-2 font-medium">Paper</th>
                <th className="px-3 py-2 font-medium">Data</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const q = QUOTES[row.id];
                return (
                  <tr key={row.id} className="cursor-pointer border-t border-line" onClick={() => setPicked(row.id)}>
                    <td className="px-3 py-3 font-mono">{row.symbol}</td>
                    <td className="px-3 py-3">{row.assetClass}</td>
                    <td className="px-3 py-3 text-muted">{row.venueId}</td>
                    <td className="px-3 py-3 font-mono tabular-nums">{q ? fmtMicros(q.lastMicros, row.priceDecimals > 4 ? 5 : 2) : "—"}</td>
                    <td className="px-3 py-3">{row.paperEligible ? "yes" : "no"}</td>
                    <td className="px-3 py-3 text-muted">{row.dataLabel}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <aside className="border border-line bg-surface p-4 text-sm">
          <p className="font-mono text-xs text-brass">{inst.symbol}</p>
          <h2 className="mt-1 text-lg">{inst.name}</h2>
          <p className="mt-3 text-muted">{inst.notes}</p>
          <dl className="mt-4 space-y-2">
            <Item label="Session" value={inst.session} />
            <Item label="Currency" value={inst.currency} />
            <Item label="Lot" value={`${inst.lotMicros} micros`} />
            <Item label="Tick" value={`${inst.tickMicros} micros`} />
            <Item label="Multiplier" value={String(inst.multiplier)} />
            <Item label="Factor" value={inst.factor} />
            <Item label="Leveraged" value={inst.leveraged ? "yes — blocked" : "no"} />
            <Item label="Live" value="locked" />
            {quote ? <Item label="As of" value={quote.exchangeTs} /> : null}
            {inst.contract?.expiry ? <Item label="Expiry" value={inst.contract.expiry} /> : null}
            {inst.contract?.delivery ? <Item label="Delivery" value={inst.contract.delivery} /> : null}
            {inst.contract?.payoff ? <Item label="Payoff" value={inst.contract.payoff} /> : null}
          </dl>
          <div className="mt-4">
            <Pill tone={inst.paperEligible ? "brass" : "muted"}>{inst.paperEligible ? "Paper eligible" : "Model only"}</Pill>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[6rem_1fr] gap-2">
      <dt className="text-muted">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
