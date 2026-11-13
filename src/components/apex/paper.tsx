import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { paperActionFn, paperDeskFn } from "@/lib/apex/api";
import type { PaperDeskView } from "@/lib/apex/broker/view";
import { Banner, Panel, Stat } from "./ui";

const DRAFT_KEY = "apex-paper-key-draft";

function readDraft(): { keyId: string; secret: string } {
  if (typeof window === "undefined") return { keyId: "", secret: "" };
  try {
    const parsed = JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? "") as { keyId?: unknown; secret?: unknown };
    return {
      keyId: typeof parsed.keyId === "string" ? parsed.keyId : "",
      secret: typeof parsed.secret === "string" ? parsed.secret : "",
    };
  } catch {
    return { keyId: "", secret: "" };
  }
}

export function PaperPanel() {
  const load = useServerFn(paperDeskFn);
  const act = useServerFn(paperActionFn);
  const [desk, setDesk] = useState<PaperDeskView | null>(null);
  const [phrase, setPhrase] = useState("");
  const [symbol, setSymbol] = useState("SPY");
  const [keyId, setKeyId] = useState("");
  const [secret, setSecret] = useState("");
  const [checking, setChecking] = useState(true);
  const [draftReady, setDraftReady] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const draft = readDraft();
    setKeyId((current) => current || draft.keyId);
    setSecret((current) => current || draft.secret);
    setDraftReady(true);
    void refresh();
    // The saved key is read once on open. This does not clear the boxes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!draftReady) return;
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ keyId, secret }));
  }, [draftReady, keyId, secret]);

  async function refresh() {
    setError("");
    try {
      setDesk(await load({ data: { refresh: true } }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The paper desk did not answer.");
    } finally {
      setChecking(false);
    }
  }

  async function pasteInto(which: "id" | "secret") {
    setError("");
    try {
      const text = (await navigator.clipboard.readText()).replace(/\s+/g, "");
      if (!text) {
        setError("The clipboard was empty. Use the manual steps under the boxes.");
        return;
      }
      if (which === "id") setKeyId(text);
      else setSecret(text);
    } catch {
      setError("Clipboard reading is blocked. Use the manual steps under the boxes.");
    }
  }

  async function run(action: string, extra: { symbol?: string; operatorConfirmed?: boolean; phrase?: string } = {}) {
    setError("");
    try {
      setDesk(await act({ data: { action, ...extra } }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The paper action was refused.");
    }
  }

  async function saveKeys() {
    setError("");
    const id = keyId.replace(/\s+/g, "");
    const sec = secret.replace(/\s+/g, "");
    if (!id || !sec) {
      setError(id ? "The secret box is still empty." : sec ? "The key ID box is still empty." : "Both boxes are still empty.");
      return;
    }
    try {
      const next = await act({ data: { action: "store-keys", keyId: id, secret: sec } });
      setDesk(next);
      if (next.keysStored) {
        setKeyId("");
        setSecret("");
        sessionStorage.removeItem(DRAFT_KEY);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The paper key was refused. Both values are still in the boxes.");
    }
  }

  const connected = desk?.connected === true;
  return (
    <div className="space-y-4">
      <Banner>
        Alpaca paper only. Live trading is not implemented. Nothing is sent to Alpaca until both keys are saved. An empty panel is not a placeholder account.
      </Banner>
      <Panel title="Paper keys" kicker={desk?.keysStored ? "Stored on the server" : checking ? "Checking" : "Not sent yet"}>
        <p className="text-sm text-muted">
          {desk?.keysStored
            ? "The saved paper key is still on the server. These boxes are only for replacing it. A reload checks Alpaca again and does not erase the saved key."
            : "Monitoring stays idle until both values are saved. Typing in these boxes is not cleared by a desk refresh."}
        </p>
        <form
          className="mt-3 grid gap-2 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            void saveKeys();
          }}
        >
          <label className="block text-xs text-muted">
            Paper key ID
            <textarea
              className="mt-1 h-20 w-full resize-y border border-line bg-bg px-3 py-2 font-mono text-sm text-fg"
              name="paper-key-id"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              value={keyId}
              onChange={(event) => setKeyId(event.target.value)}
            />
          </label>
          <label className="block text-xs text-muted">
            Paper secret
            <textarea
              className="mt-1 h-20 w-full resize-y border border-line bg-bg px-3 py-2 font-mono text-sm text-fg"
              name="paper-secret"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
            />
          </label>
          <p className="text-xs text-muted sm:col-span-2">
            Key ID {keyId.replace(/\s+/g, "").length} characters. Secret {secret.replace(/\s+/g, "").length} characters. Spaces and line breaks are ignored. Both counts must be greater than zero before Save.
          </p>
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <button type="button" className="border border-line px-3 py-2 text-sm" onClick={() => void pasteInto("id")}>Paste key ID</button>
            <button type="button" className="border border-line px-3 py-2 text-sm" onClick={() => void pasteInto("secret")}>Paste secret</button>
            <button type="submit" className="bg-brass px-3 py-2 text-sm text-brass-ink">Save paper keys</button>
          </div>
        </form>
        <ol className="mt-3 list-decimal space-y-1 pl-4 text-sm text-muted">
          <li>Copy the paper key ID. Click inside the Paper key ID box. Right-click and choose Paste, or press Ctrl+V or Cmd+V. You can also type it.</li>
          <li>Copy the paper secret. Click inside the Paper secret box. Paste or type it the same way. The first box must still show the key ID.</li>
          <li>Check the two character counts. If either is zero, that value was not entered.</li>
          <li>Press Save paper keys. The boxes clear only after the server confirms both were stored.</li>
        </ol>
        <p className="mt-2 text-xs text-muted">
          {checking && !desk ? "Checking the saved paper key." : desk?.keysStored ? "A paper key is already stored. The secret is not shown again." : "No paper key is stored yet."}
        </p>
      </Panel>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Launch mode" value={desk?.launchMode ?? (checking ? "CHECKING" : "IDLE")} hint={desk ? "Saved keys only" : checking ? "Asking the paper host" : "No broker call yet"} />
        <Stat label="Paper account" value={connected ? "Authenticated" : checking ? "Checking" : "Not connected"} tone={connected ? "gain" : "warn"} hint={desk?.host ?? "Waiting for a saved paper key"} />
        <Stat label="Broker equity" value={desk?.account ? `$${desk.account.equity}` : "—"} hint="Reported by Alpaca, or blank" />
        <Stat label="Cash" value={desk?.account ? `$${desk.account.cash}` : "—"} hint={desk?.account ? `Buying power $${desk.account.buyingPower}` : "No broker cash figure"} />
      </div>
      <Panel title="Session" kicker={desk?.clock?.isOpen ? "Market open" : "Clock"}>
        <p className="text-sm text-muted">{desk?.reason ?? (checking ? "Checking the saved paper key." : "Idle. No broker call until both keys are saved.")}</p>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <Item label="Clock" value={desk?.clock ? `${desk.clock.timestamp} · ${desk.clock.isOpen ? "open" : "closed"}` : "No clock"} />
          <Item label="Last data" value={desk?.lastDataTs ?? "No timestamp"} />
          <Item label="Data" value={desk ? `${desk.dataFeed} · ${desk.dataNote}` : "—"} />
          <Item label="Streams" value={desk?.streamNote ?? "—"} />
          <Item label="Safety checks" value={desk ? (desk.safetyPassed ? "Passed locally" : desk.safetyFailed.join(" ")) : "—"} />
          <Item label="Reconcile" value={desk?.reconciliationClean ? "Broker positions match filled qty" : (desk?.reconciliationNotes.join(" ") || "Not confirmed")} />
        </dl>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className="border border-line px-3 py-2 text-sm" onClick={() => void refresh()}>Refresh</button>
          <button type="button" className="border border-line px-3 py-2 text-sm" onClick={() => void run("propose-smoke")}>Propose 1 SPY smoke</button>
          <button type="button" className="border border-line px-3 py-2 text-sm" onClick={() => void run("arm-manual")}>Arm paper manual</button>
          <button type="button" className="border border-line px-3 py-2 text-sm" onClick={() => void run("disarm")}>Back to monitoring</button>
          <button type="button" className="border border-loss px-3 py-2 text-sm text-loss" onClick={() => void run("emergency")}>Emergency stop</button>
        </div>
        <form
          className="mt-3 flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void run("approve-auto", { phrase });
          }}
        >
          <input className="min-w-0 flex-1 border border-line bg-bg px-3 py-2 text-sm" value={phrase} placeholder="Type APPROVE PAPER AUTO" onChange={(event) => setPhrase(event.target.value)} />
          <button type="submit" className="border border-line px-3 py-2 text-sm">Approve paper auto</button>
        </form>
      </Panel>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Broker positions" kicker="Alpaca paper">
          {desk && desk.positions.length === 0 ? <p className="text-sm text-muted">No broker positions were returned.</p> : null}
          <ul className="space-y-2">
            {desk?.positions.map((row) => (
              <li key={row.symbol} className="grid grid-cols-2 gap-2 border-b border-line pb-2 font-mono text-xs sm:grid-cols-4">
                <span>{row.symbol}</span>
                <span>{row.qty}</span>
                <span>{row.unrealizedPl}</span>
                <span>{row.marketValue}</span>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Working orders" kicker="Paper broker ids">
          {desk && desk.orders.length === 0 ? <p className="text-sm text-muted">No paper orders in this session.</p> : null}
          <ul className="space-y-2">
            {desk?.orders.map((order) => (
              <li key={order.clientOrderId} className="border-b border-line pb-2 text-sm">
                <span className="font-mono text-xs">{order.symbol} {order.side} {order.qty} · {order.state}</span>
                <span className="mt-1 block text-muted">{order.reason}</span>
                {["submitted", "accepted", "partially_filled", "pending_cancel"].includes(order.state) ? (
                  <button type="button" className="mt-1 border border-line px-2 py-1 text-xs" onClick={() => void run("cancel", { symbol: order.clientOrderId })}>
                    Cancel
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </Panel>
      </div>
      <Panel title="Signals" kicker="Experimental opening range">
        <p className="mb-3 text-sm text-muted">Fifteen-minute breakout, long only, unadjusted bars. Not a validated strategy. The old negative cost study is unchanged.</p>
        <ul className="space-y-2">
          {desk?.signals.map((signal) => (
            <li key={signal.symbol} className="grid gap-1 border-b border-line pb-2 text-sm md:grid-cols-[5rem_8rem_1fr]">
              <span className="font-mono">{signal.symbol}</span>
              <span>{signal.action}</span>
              <span className="text-muted">{signal.reason}</span>
            </li>
          ))}
          {desk && desk.signals.length === 0 ? <li className="text-sm text-muted">No signal. Market data was not authenticated, or the market is closed.</li> : null}
        </ul>
        <form
          className="mt-4 flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void run("propose-entry", { symbol });
          }}
        >
          <select className="border border-line bg-bg px-3 py-2 text-sm" value={symbol} onChange={(event) => setSymbol(event.target.value)}>
            {["SPY", "QQQ", "IWM", "GLD", "TLT"].map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
          <button type="submit" className="border border-line px-3 py-2 text-sm">Propose paper order</button>
        </form>
        {desk?.proposal ? (
          <div className="mt-3 border border-line p-3 text-sm">
            <p className="font-mono text-xs">{desk.proposal.symbol} {desk.proposal.side} {desk.proposal.qty} · {desk.proposal.clientOrderId}</p>
            <p className="mt-1 text-muted">{desk.proposal.eligible ? "Eligible. Operator confirmation still required." : desk.proposal.reasons.join(" ")}</p>
            <p className="mt-1 text-xs text-muted">Notional {desk.proposal.notionalCents} cents. Cash {desk.proposal.cashCents} cents. Market {desk.proposal.marketOpen ? "open" : "closed"}.</p>
            {desk.proposal.eligible ? (
              <button type="button" className="mt-2 bg-brass px-3 py-2 text-sm text-brass-ink" disabled={!connected || desk.launchMode === "MONITORING"} onClick={() => void run("confirm-entry", { symbol: desk.proposal?.symbol, operatorConfirmed: true })}>
                Confirm paper entry
              </button>
            ) : null}
          </div>
        ) : null}
        <p className="mt-2 text-xs text-muted">Nothing is sent while the market is closed, while mode is monitoring, or before operator confirmation. Live is not selectable.</p>
      </Panel>
      <Panel title="Events">
        <ul className="space-y-2">
          {(desk?.events ?? []).slice().reverse().map((item) => (
            <li key={`${item.ts}-${item.text}`} className="grid gap-1 border-b border-line pb-2 text-sm md:grid-cols-[14rem_1fr]">
              <span className="font-mono text-xs text-muted">{item.ts.slice(11, 19)} UTC</span>
              <span>{item.text}</span>
            </li>
          ))}
        </ul>
        {error ? <p className="mt-3 text-sm text-loss">{error}</p> : null}
        {desk?.riskNotes.length ? <p className="mt-3 text-sm text-warn">{desk.riskNotes.join(" ")}</p> : null}
      </Panel>
    </div>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="break-words">{value}</dd>
    </div>
  );
}
