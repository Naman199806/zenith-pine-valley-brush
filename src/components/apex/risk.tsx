import { dailyPnlCents, drawdown, equityCents, exposures } from "@/lib/apex/domain";
import { fmtCents, fmtPct } from "@/lib/apex/money";
import { useApex } from "@/lib/apex/session";
import { Banner, Button, Panel } from "./ui";

export function Risk() {
  const { book, busy, kill } = useApex();
  const eq = equityCents(book);
  const loss = Math.max(0, -dailyPnlCents(book)) / (book.dayStartEquityCents || 1);
  const dd = drawdown(book);
  const gross = eq > 0 ? exposures(book).grossCents / eq : 0;
  return (
    <div className="space-y-4">
      <Banner tone="loss">
        The risk officer agent is advice. These limits are the authority. A stop does not contain a gap, a halt, or a disconnect. Flatten requested is not flat.
      </Banner>
      <div className="grid gap-4 md:grid-cols-2">
        <Meter label="Daily loss" value={loss} marks={[{ at: 0.005, name: "Alert 0.5%" }, { at: 0.01, name: "Block 1%" }]} display={fmtPct(loss)} />
        <Meter label="Drawdown from peak" value={dd} marks={[{ at: 0.05, name: "Review 5%" }, { at: 0.08, name: "Shutdown 8%" }]} display={fmtPct(dd)} />
        <Meter label="Gross exposure" value={gross} marks={[{ at: 0.1, name: "Strategy cap 10%" }, { at: 0.15, name: "Factor cap 15%" }]} display={fmtPct(gross)} />
        <Panel title="Book limits" kicker="paper-defaults-v1">
          <ul className="space-y-2 text-sm text-muted">
            <li>Risk per unleveraged trade: 0.25% of equity, about {fmtCents(Math.round(eq * 0.0025))} today.</li>
            <li>No leverage, no naked options, no shorts, no averaging down.</li>
            <li>Single strategy cap: 10%. Same-factor add stops at 8% instead of being resized.</li>
            <li>Credentials: {book.credentials}. Data: {book.dataStatus}. Reconciliation: {book.reconciliation}.</li>
            <li>Positions confirmed flat: {String(book.kill.positionsConfirmedFlat)}.</li>
          </ul>
        </Panel>
      </div>
      <Panel title="Kill switch" action={<span className="font-mono text-xs text-muted">{book.kill.blockNew ? "NEW RISK BLOCKED" : "ARMED"}</span>}>
        <div className="flex flex-wrap gap-2">
          <Button tone="loss" disabled={busy} onClick={() => void kill("block")}>Block new orders</Button>
          <Button disabled={busy} onClick={() => void kill("cancel")}>Request cancels</Button>
          <Button tone="loss" disabled={busy} onClick={() => void kill("flatten")}>Request flatten</Button>
          <Button disabled={busy} onClick={() => void kill("release-block")}>Release block</Button>
        </div>
        <p className="mt-3 text-sm text-muted">
          Cancel requested: {String(book.kill.cancelRequested)}. Flatten requested: {String(book.kill.flattenRequested)}. Simulator connected: {String(book.kill.brokerConnected)}. Confirmed flat: {String(book.kill.positionsConfirmedFlat)}.
        </p>
      </Panel>
    </div>
  );
}

function Meter({ label, value, display, marks }: { label: string; value: number; display: string; marks: { at: number; name: string }[] }) {
  return (
    <Panel title={label} action={<span className="font-mono text-sm tabular-nums">{display}</span>}>
      <div className="h-2 bg-surface-2">
        <div className={`h-2 ${value >= 0.08 ? "bg-loss" : "bg-brass"}`} style={{ width: `${Math.min(100, value * 100 * 4)}%` }} />
      </div>
      <ul className="mt-3 space-y-1 text-xs text-muted">
        {marks.map((mark) => (
          <li key={mark.name}>{mark.name}{value >= mark.at ? " — reached" : ""}</li>
        ))}
      </ul>
    </Panel>
  );
}
