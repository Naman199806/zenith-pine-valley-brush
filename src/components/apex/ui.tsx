import type { ReactNode } from "react";

export function Panel({ title, kicker, action, children }: { title: string; kicker?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="border border-line bg-surface">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div>
          {kicker ? <p className="font-mono text-xs tracking-wide text-brass">{kicker}</p> : null}
          <h2 className="text-sm font-medium text-fg">{title}</h2>
        </div>
        {action}
      </header>
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint, tone = "fg" }: { label: string; value: string; hint?: string; tone?: "fg" | "gain" | "loss" | "warn" | "brass" }) {
  const color = { fg: "text-fg", gain: "text-gain", loss: "text-loss", warn: "text-warn", brass: "text-brass" }[tone];
  return (
    <div className="border border-line bg-surface px-4 py-3">
      <p className="text-xs text-muted">{label}</p>
      <p className={`mt-1 font-mono text-2xl tabular-nums ${color}`}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export function Banner({ children, tone = "warn" }: { children: ReactNode; tone?: "warn" | "loss" | "brass" }) {
  const color = tone === "loss" ? "border-loss text-fg" : tone === "brass" ? "border-brass text-fg" : "border-warn text-fg";
  return <p className={`border-l-2 bg-surface px-4 py-3 text-sm ${color}`}>{children}</p>;
}

export function Pill({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "brass" | "loss" | "gain" | "warn" }) {
  const color = {
    muted: "border-line text-muted",
    brass: "border-brass text-brass",
    loss: "border-loss text-loss",
    gain: "border-gain text-gain",
    warn: "border-warn text-warn",
  }[tone];
  return <span className={`inline-flex items-center border px-2 py-1 font-mono text-xs ${color}`}>{children}</span>;
}

export function Button({
  children,
  onClick,
  disabled,
  tone = "ghost",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  tone?: "ghost" | "brass" | "loss";
}) {
  const color =
    tone === "brass"
      ? "bg-brass text-brass-ink"
      : tone === "loss"
        ? "border border-loss text-loss"
        : "border border-line text-fg";
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`px-3 py-2 text-sm transition-opacity ${color}`}>
      {children}
    </button>
  );
}
