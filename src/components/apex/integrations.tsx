import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { integrationsFn } from "@/lib/apex/api";
import type { FrameworkHealth } from "@/lib/apex/integrations/contracts";
import { Banner, Panel } from "./ui";

export function Integrations() {
  const load = useServerFn(integrationsFn);
  const [rows, setRows] = useState<FrameworkHealth[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        setRows(await load());
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "The integration report did not load.");
      }
    })();
    // One read on open. It does not submit an order.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-4">
      <Banner>
        One portfolio, one risk engine, one order path. Research engines cannot submit an Alpaca order. TESTED means a process ran. It is not ACTIVE, not INTEGRATED, and not a license clearance. GPL engines still need counsel before distribution.
      </Banner>
      {error ? <p className="text-sm text-loss">{error}</p> : null}
      {(rows ?? []).map((row) => (
        <Panel key={row.id} title={row.name} kicker={`${row.status} · ${row.license}`}>
          <dl className="grid gap-3 text-sm md:grid-cols-2">
            <Item label="Version" value={row.version ?? "Unknown"} />
            <Item label="Process" value={row.process} />
            <Item label="Last test" value={row.lastTest ?? "None"} />
            <Item label="Capability" value={row.activeCapability} />
            <Item label="Permissions" value={row.permissions} />
            <Item label="Runtime" value={row.runtime} />
            <Item label="Health" value={row.health} />
            <Item label="Boundary" value={row.boundary} />
          </dl>
          {row.errors.length > 0 ? <p className="mt-3 text-sm text-warn">{row.errors.join(" ")}</p> : null}
        </Panel>
      ))}
      {rows === null && !error ? <p className="text-sm text-muted">Checking installed runtimes.</p> : null}
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
