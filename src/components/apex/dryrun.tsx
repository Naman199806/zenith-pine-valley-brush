import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { dryRunFn } from "@/lib/apex/api";
import type { DryRunView } from "@/lib/apex/broker/dryrun.server";
import { Panel, Stat } from "./ui";

export function DryRunPanel() {
  const load = useServerFn(dryRunFn);
  const [view, setView] = useState<DryRunView | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refresh() {
    try {
      setView(await load());
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Dry-run reader failed.");
    }
  }

  const status = view?.status ?? "OFFLINE";
  return (
    <Panel title="Freqtrade dry-run — not Alpaca">
      <p className="text-sm text-muted-foreground">Simulated Kraken position. This is not a broker-paper or live position.</p>
      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Status" value={status} hint={view?.heartbeatAgeSec != null ? `Heartbeat ${view.heartbeatAgeSec}s ago` : "No heartbeat"} />
        <Stat label="Strategy" value={view?.strategy ?? "—"} hint={view?.mode ?? "DRY-RUN"} />
        <Stat label="Pair" value={view?.position?.pair ?? "none"} hint={view?.position ? `qty ${view.position.qty}` : "No open trade"} />
        <Stat label="Entry" value={view?.position?.entry ?? "—"} hint={view?.position?.openDate ?? ""} />
      </div>
      <button type="button" className="text-sm underline" onClick={() => void refresh()}>Refresh</button>
    </Panel>
  );
}
