import { Link, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { dailyPnlCents, drawdown, equityCents } from "@/lib/apex/domain";
import { ApexProvider, useApex } from "@/lib/apex/session";
import { fmtCents, fmtPct } from "@/lib/apex/money";

const NAV = [
  { to: "/", label: "Overview" },
  { to: "/markets", label: "Markets" },
  { to: "/research", label: "Research" },
  { to: "/lab", label: "Strategy lab" },
  { to: "/portfolio", label: "Portfolio" },
  { to: "/terminal", label: "Terminal" },
  { to: "/risk", label: "Risk" },
  { to: "/agents", label: "Agents" },
  { to: "/ops", label: "Operations" },
  { to: "/integrations", label: "Integrations" },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <ApexProvider>
      <Frame>{children}</Frame>
    </ApexProvider>
  );
}

function Frame({ children }: { children: ReactNode }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { book, busy, paper, research, kill } = useApex();
  const equity = equityCents(book);
  const pnl = dailyPnlCents(book);
  return (
    <div className="min-h-screen bg-bg text-fg">
      <header className="border-b border-line bg-surface">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center border border-brass font-mono text-xs text-brass">AX</span>
            <div>
              <p className="text-sm font-medium tracking-wide">APEX QUANT X</p>
              <p className="text-xs text-muted">Research organization · simulated capital</p>
            </div>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <span className="border border-brass px-2 py-1 font-mono text-xs text-brass">{book.mode}</span>
            <span className="border border-line px-2 py-1 font-mono text-xs text-muted">FIXTURE DATA</span>
            <span className="border border-line px-2 py-1 font-mono text-xs text-muted">
              {book.kill.brokerConnected ? "PAPER SIMULATOR" : "BROKER OFF"}
            </span>
            <span className="font-mono text-sm tabular-nums">{fmtCents(equity)}</span>
            <span className={`font-mono text-sm tabular-nums ${pnl < 0 ? "text-loss" : pnl > 0 ? "text-gain" : "text-muted"}`}>{fmtCents(pnl)}</span>
            <span className="font-mono text-xs text-muted">DD {fmtPct(drawdown(book))}</span>
          </div>
        </div>
        <div className="flex max-w-full gap-2 overflow-x-auto border-t border-line px-2 py-2 md:hidden">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} active={path === item.to}>
              {item.label}
            </NavLink>
          ))}
        </div>
      </header>
      <div className="md:grid md:grid-cols-[13rem_1fr]">
        <nav className="hidden border-r border-line md:block">
          <ul className="sticky top-0 flex flex-col gap-1 p-3">
            {NAV.map((item) => (
              <li key={item.to}>
                <NavLink to={item.to} active={path === item.to}>
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
            <button type="button" className="border border-line px-3 py-2 text-sm" disabled={busy} onClick={() => void research()}>
              Research
            </button>
            <button type="button" className="bg-brass px-3 py-2 text-sm text-brass-ink" disabled={busy} onClick={() => void paper()}>
              Enable paper
            </button>
            <button type="button" className="border border-loss px-3 py-2 text-sm text-loss" disabled={busy} onClick={() => void kill("block")}>
              Block new risk
            </button>
            <p className="basis-full text-sm text-muted">{busy ? "Risk service is working." : book.lastMessage}</p>
          </div>
          <main className="space-y-4 px-4 py-4 md:px-6 md:py-6">{children}</main>
        </div>
      </div>
    </div>
  );
}

function NavLink({ to, active, children }: { to: (typeof NAV)[number]["to"]; active: boolean; children: ReactNode }) {
  return (
    <Link
      to={to}
      className={`block whitespace-nowrap px-3 py-2 text-sm ${active ? "bg-brass text-brass-ink" : "text-muted"}`}
    >
      {children}
    </Link>
  );
}
