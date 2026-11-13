import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
//#region node_modules/.nitro/vite/services/ssr/assets/dryrun.server-BXbUm7Qm.js
var DB = "/workspace/.runtimes/freqtrade-run/state/dryrun.sqlite";
var LOG = "/workspace/.runtimes/freqtrade-run/dryrun.log";
var PID = "/workspace/.runtimes/freqtrade-run/dryrun.pid";
function heartbeatAge() {
	try {
		const last = readFileSync(LOG, "utf8").split("\n").filter((line) => line.includes("Bot heartbeat")).at(-1);
		if (!last) return {
			age: null,
			pid: null
		};
		const stamp = last.slice(0, 19).replace(" ", "T") + "Z";
		const age = Math.round((Date.now() - Date.parse(stamp)) / 1e3);
		const pid = Number(readFileSync(PID, "utf8").trim());
		return {
			age: Number.isFinite(age) ? age : null,
			pid: Number.isFinite(pid) ? pid : null
		};
	} catch {
		return {
			age: null,
			pid: null
		};
	}
}
function readDryRun() {
	const beat = heartbeatAge();
	let position = null;
	let dbOk = false;
	try {
		const db = new DatabaseSync(DB, { readOnly: true });
		const row = db.prepare("SELECT pair, amount, open_rate, open_date, is_open, close_rate, exit_reason, close_profit_abs FROM trades ORDER BY id DESC LIMIT 1").get();
		db.close();
		dbOk = true;
		if (row) position = {
			pair: row.pair,
			qty: String(row.amount),
			entry: String(row.open_rate),
			openDate: row.open_date,
			open: row.is_open === 1,
			exit: row.close_rate == null ? null : String(row.close_rate),
			exitReason: row.exit_reason,
			pnl: row.close_profit_abs == null ? null : String(row.close_profit_abs)
		};
	} catch {
		dbOk = false;
	}
	const alive = beat.age !== null && beat.age < 180;
	return {
		source: "freqtrade-dry-run",
		notBroker: true,
		status: !dbOk || beat.age === null ? "OFFLINE" : alive ? "RUNNING" : "STALE",
		pid: beat.pid,
		heartbeatAgeSec: beat.age,
		exchange: "Kraken",
		mode: "DRY-RUN",
		strategy: "ApexDry",
		position,
		dbOk,
		note: "Simulated. Not an Alpaca paper position. Not live."
	};
}
//#endregion
export { readDryRun };
