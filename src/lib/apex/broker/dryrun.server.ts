import { readFileSync, statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB = "/workspace/.runtimes/freqtrade-run/state/dryrun.sqlite";
const LOG = "/workspace/.runtimes/freqtrade-run/dryrun.log";
const PID = "/workspace/.runtimes/freqtrade-run/dryrun.pid";

export interface DryRunView {
  source: "freqtrade-dry-run";
  notBroker: true;
  status: "RUNNING" | "STALE" | "OFFLINE";
  pid: number | null;
  heartbeatAgeSec: number | null;
  exchange: "Kraken";
  mode: "DRY-RUN";
  strategy: "ApexDry";
  position: {
    pair: string;
    qty: string;
    entry: string;
    openDate: string;
    open: boolean;
    exit: string | null;
    exitReason: string | null;
    pnl: string | null;
  } | null;
  dbOk: boolean;
  note: string;
}

function heartbeatAge(): { age: number | null; pid: number | null } {
  try {
    const text = readFileSync(LOG, "utf8");
    const lines = text.split("\n").filter((line) => line.includes("Bot heartbeat"));
    const last = lines.at(-1);
    if (!last) return { age: null, pid: null };
    const stamp = last.slice(0, 19).replace(" ", "T") + "Z";
    const age = Math.round((Date.now() - Date.parse(stamp)) / 1000);
    const pid = Number(readFileSync(PID, "utf8").trim());
    return { age: Number.isFinite(age) ? age : null, pid: Number.isFinite(pid) ? pid : null };
  } catch {
    return { age: null, pid: null };
  }
}

export function readDryRun(): DryRunView {
  const beat = heartbeatAge();
  let position: DryRunView["position"] = null;
  let dbOk = false;
  try {
    const db = new DatabaseSync(DB, { readOnly: true });
    const row = db.prepare("SELECT pair, amount, open_rate, open_date, is_open, close_rate, exit_reason, close_profit_abs FROM trades ORDER BY id DESC LIMIT 1").get() as
      | { pair: string; amount: number; open_rate: number; open_date: string; is_open: number; close_rate: number | null; exit_reason: string | null; close_profit_abs: number | null }
      | undefined;
    db.close();
    dbOk = true;
    if (row) {
      position = {
        pair: row.pair,
        qty: String(row.amount),
        entry: String(row.open_rate),
        openDate: row.open_date,
        open: row.is_open === 1,
        exit: row.close_rate == null ? null : String(row.close_rate),
        exitReason: row.exit_reason,
        pnl: row.close_profit_abs == null ? null : String(row.close_profit_abs),
      };
    }
  } catch {
    dbOk = false;
  }
  const alive = beat.age !== null && beat.age < 180;
  const status = !dbOk || beat.age === null ? "OFFLINE" : alive ? "RUNNING" : "STALE";
  return {
    source: "freqtrade-dry-run",
    notBroker: true,
    status,
    pid: beat.pid,
    heartbeatAgeSec: beat.age,
    exchange: "Kraken",
    mode: "DRY-RUN",
    strategy: "ApexDry",
    position,
    dbOk,
    note: "Simulated. Not an Alpaca paper position. Not live.",
  };
}

export function dryRunDbMtime(): string | null {
  try {
    return statSync(DB).mtime.toISOString();
  } catch {
    return null;
  }
}
