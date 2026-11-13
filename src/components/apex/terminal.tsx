import { useState } from "react";
import { INSTRUMENTS } from "@/lib/apex/domain";
import { fmtMicros } from "@/lib/apex/money";
import { useApex } from "@/lib/apex/session";
import { closeIntent, evaluateRisk, sizingPreview } from "@/lib/apex/trading";
import { Banner, Button, Panel, Pill } from "./ui";

export function Terminal() {
  const { book, busy, submit } = useApex();
  const eligible = INSTRUMENTS.filter((i) => i.paperEligible);
  const [symbol, setSymbol] = useState("SPY");
  const held = book.positions.find((p) => p.instrumentId === symbol && p.qtyMicros > 0);
  const intent = sizingPreview(book, symbol);
  const decision = evaluateRisk(book, intent);
  return (
    <div className="space-y-4">
      <Banner tone={book.mode === "PAPER" ? "brass" : "warn"}>
        {book.mode === "PAPER"
          ? "Paper simulator only. Fills use the fixture plus 2 bps and are tagged plumbing, not evidence. Live orders cannot be created."
          : "Research mode. The execution service will reject every order, including this preview."}
      </Banner>
      <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
        <Panel title="Ticket" kicker="Execution service">
          <label className="block text-xs text-muted" htmlFor="symbol">Instrument</label>
          <select id="symbol" className="mt-1 w-full border border-line bg-bg px-3 py-2 text-sm" value={symbol} onChange={(e) => setSymbol(e.target.value)}>
            {eligible.map((i) => (
              <option key={i.id} value={i.id}>{i.symbol}</option>
            ))}
          </select>
          <dl className="mt-3 space-y-1 text-sm">
            <div className="flex justify-between gap-2"><dt className="text-muted">Requested</dt><dd className="font-mono">250 sh</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-muted">Risk size</dt><dd className="font-mono">{decision.adjustedQtyMicros / 1_000_000} sh</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-muted">Stop</dt><dd className="font-mono">2%</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-muted">Key</dt><dd className="font-mono text-xs">{intent.idempotencyKey}</dd></div>
          </dl>
          <p className="mt-3 text-sm text-muted">{decision.reasons.join(" ")}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button tone="brass" disabled={busy} onClick={() => void submit(sizingPreview(book, symbol))}>Submit buy</Button>
            <Button disabled={busy || !held} onClick={() => held && void submit(closeIntent(book, symbol))}>Close</Button>
          </div>
        </Panel>
        <Panel title="Order lifecycle">
          {book.orders.length === 0 ? (
            <p className="text-sm text-muted">No orders. A rejection will appear here and will not be treated as a fill.</p>
          ) : (
            <ul className="space-y-3">
              {[...book.orders].reverse().map((order) => (
                <li key={order.id} className="border border-line p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono">{order.id}</span>
                    <Pill tone={order.state === "filled" ? "brass" : order.state === "rejected" || order.state === "cancel_rejected" ? "loss" : "warn"}>{order.state}</Pill>
                    <span className="text-muted">{order.side} {order.instrumentId}</span>
                    <span className="font-mono text-xs text-muted">{order.idempotencyKey}</span>
                  </div>
                  <p className="mt-2 text-muted">{order.rejectReason ?? order.fills[0]?.slippageNote ?? "No fill."}</p>
                  {order.fills.map((fill) => (
                    <p key={fill.id} className="mt-1 font-mono text-xs tabular-nums">
                      {fill.id} · {fill.qtyMicros / 1_000_000} @ {fmtMicros(fill.priceMicros)} · fee {fill.feeCents}¢
                    </p>
                  ))}
                  <p className="mt-1 text-xs text-muted">Strategy {order.strategyId}@{order.strategyVersion} · risk {order.riskDecisionId} · live {String(order.live)}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
