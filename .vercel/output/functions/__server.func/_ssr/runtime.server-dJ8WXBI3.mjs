import { a as maySubmit, c as DATA_STREAM_URL, d as assertPaperUrl, f as redactSecrets, i as sizePaperOrder, l as PAPER_TRADING_ORIGIN, n as runPaperSafety, o as promoteLaunch, p as tradingOriginGuard, r as PAPER_RISK, s as DATA_ORIGIN, u as TRADE_STREAM_URL } from "./api-BtKtHxFN.mjs";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
//#region node_modules/.nitro/vite/services/ssr/assets/runtime.server-dJ8WXBI3.js
var NEXT = {
	created: ["risk_approved", "rejected"],
	risk_approved: ["submitted", "rejected"],
	submitted: [
		"accepted",
		"partially_filled",
		"filled",
		"rejected",
		"canceled",
		"expired",
		"unknown_pending_reconciliation"
	],
	accepted: [
		"partially_filled",
		"filled",
		"pending_cancel",
		"canceled",
		"rejected",
		"expired",
		"unknown_pending_reconciliation"
	],
	partially_filled: [
		"partially_filled",
		"filled",
		"pending_cancel",
		"canceled",
		"expired",
		"unknown_pending_reconciliation"
	],
	filled: [],
	pending_cancel: [
		"canceled",
		"filled",
		"partially_filled",
		"unknown_pending_reconciliation"
	],
	canceled: [],
	rejected: [],
	expired: [],
	unknown_pending_reconciliation: [
		"accepted",
		"partially_filled",
		"filled",
		"pending_cancel",
		"canceled",
		"rejected",
		"expired"
	]
};
function transition(from, to) {
	if (from === to && (from === "partially_filled" || from === "unknown_pending_reconciliation")) return from;
	if (!NEXT[from].includes(to)) throw new Error(`Illegal order transition ${from} -> ${to}.`);
	return to;
}
function mapBrokerStatus(status) {
	switch (status) {
		case "new":
		case "accepted":
		case "pending_new":
		case "accepted_for_bidding": return "accepted";
		case "partially_filled": return "partially_filled";
		case "filled": return "filled";
		case "pending_cancel":
		case "pending_replace": return "pending_cancel";
		case "canceled":
		case "replaced": return "canceled";
		case "rejected": return "rejected";
		case "expired":
		case "done_for_day": return "expired";
		default: return "unknown_pending_reconciliation";
	}
}
function isTerminal(state) {
	return state === "filled" || state === "canceled" || state === "rejected" || state === "expired";
}
function headers(creds) {
	return {
		"APCA-API-KEY-ID": creds.keyId,
		"APCA-API-SECRET-KEY": creds.secret
	};
}
function clientOrderId(symbol, nowIso, salt) {
	return `ax${nowIso.replace(/[-:TZ.]/g, "").slice(0, 14)}${symbol}${salt}`.replace(/[^A-Za-z0-9]/g, "").slice(0, 48);
}
async function lookup(transport, creds, clientId) {
	const url = `${PAPER_TRADING_ORIGIN}/v2/orders:by_client_order_id?client_order_id=${encodeURIComponent(clientId)}`;
	assertPaperUrl(url);
	return transport.call({
		method: "GET",
		url,
		headers: headers(creds)
	});
}
async function executePaperEntry(transport, creds, input, nowIso, salt) {
	const id = clientOrderId(input.symbol, nowIso, salt);
	const blocked = maySubmit(input.mode, input.operatorConfirmed, input.autoApproved);
	const base = {
		clientOrderId: id,
		brokerId: null,
		symbol: input.symbol,
		side: input.side,
		qty: 0,
		filledQty: 0,
		state: "created",
		reason: blocked ?? "",
		theoretical: true
	};
	if (blocked || input.blockOrders) return {
		...base,
		state: transition("created", "rejected"),
		reason: blocked ?? "Orders are blocked because the trading URL was not the paper host.",
		theoretical: true
	};
	const sized = sizePaperOrder(input);
	let qty = input.closing ? input.closeQty : sized.qty;
	if (input.closing && input.closeQty < 1) return {
		...base,
		state: transition("created", "rejected"),
		reason: "There is no long to close.",
		theoretical: true
	};
	if (!input.closing && (sized.qty < 1 || sized.reasons.length)) return {
		...base,
		state: transition("created", "rejected"),
		reason: sized.reasons.join(" ") || "Risk rejected the order.",
		theoretical: true
	};
	if (sized.emergency && !input.closing) return {
		...base,
		state: transition("created", "rejected"),
		reason: sized.reasons.join(" "),
		theoretical: true
	};
	let state = transition("created", "risk_approved");
	try {
		const existing = await lookup(transport, creds, id);
		if (existing.status === 200) return {
			...adopt(state, existing.body),
			clientOrderId: id,
			symbol: input.symbol,
			side: input.side,
			reason: "Broker already has this client order id. It was not submitted again.",
			theoretical: false
		};
	} catch (error) {
		return {
			...base,
			qty,
			state: transition(state, "unknown_pending_reconciliation"),
			reason: redactSecrets(error instanceof Error ? error.message : "lookup failed", [creds.secret, creds.keyId]),
			theoretical: true
		};
	}
	state = transition(state, "submitted");
	const url = `${PAPER_TRADING_ORIGIN}/v2/orders`;
	assertPaperUrl(url);
	try {
		const response = await transport.call({
			method: "POST",
			url,
			headers: headers(creds),
			body: {
				symbol: input.symbol,
				qty: String(qty),
				side: input.side,
				type: "market",
				time_in_force: "day",
				client_order_id: id
			}
		});
		if (response.status >= 200 && response.status < 300) return {
			...adopt(state, response.body),
			clientOrderId: id,
			symbol: input.symbol,
			side: input.side,
			qty,
			theoretical: false,
			reason: "Accepted by the paper broker. This is not a live order."
		};
		const message = redactSecrets(JSON.stringify(response.body ?? ""), [creds.secret, creds.keyId]);
		return {
			...base,
			qty,
			state: transition(state, "rejected"),
			reason: message || `Paper broker rejected the order (${response.status}).`,
			theoretical: true
		};
	} catch (error) {
		return {
			...base,
			qty,
			state: transition(state, "unknown_pending_reconciliation"),
			reason: redactSecrets(error instanceof Error ? error.message : "submit failed", [creds.secret, creds.keyId]),
			theoretical: true
		};
	}
}
function orderFromBroker(body) {
	const row = body ?? {};
	return {
		clientOrderId: String(row.client_order_id ?? ""),
		brokerId: row.id ? String(row.id) : null,
		symbol: String(row.symbol ?? ""),
		side: row.side === "sell" ? "sell" : "buy",
		qty: Number(row.qty ?? 0),
		filledQty: Number(row.filled_qty ?? 0),
		state: mapBrokerStatus(String(row.status ?? "")),
		reason: "",
		theoretical: false
	};
}
function adopt(from, body) {
	const order = orderFromBroker(body);
	let state = from;
	if (state === "risk_approved") state = transition(state, "submitted");
	if (state !== order.state) state = transition(state, order.state);
	return {
		...order,
		state
	};
}
async function cancelPaperOrder(transport, creds, order) {
	if (!order.brokerId || isTerminal(order.state)) return order;
	const pending = {
		...order,
		state: transition(order.state, "pending_cancel")
	};
	const url = `${PAPER_TRADING_ORIGIN}/v2/orders/${encodeURIComponent(order.brokerId)}`;
	assertPaperUrl(url);
	try {
		const response = await transport.call({
			method: "DELETE",
			url,
			headers: headers(creds)
		});
		if (response.status === 204 || response.status === 200) return {
			...pending,
			state: transition(pending.state, "canceled"),
			reason: "Cancel requested. A late fill is still possible until the broker confirms."
		};
		return {
			...pending,
			state: transition(pending.state, "unknown_pending_reconciliation"),
			reason: `Cancel was not confirmed (${response.status}).`
		};
	} catch (error) {
		return {
			...pending,
			state: transition(pending.state, "unknown_pending_reconciliation"),
			reason: redactSecrets(error instanceof Error ? error.message : "cancel failed", [creds.secret, creds.keyId])
		};
	}
}
`${DATA_ORIGIN}`;
var ORB_SYMBOLS = [
	"SPY",
	"QQQ",
	"IWM",
	"GLD",
	"TLT"
];
function etParts(iso) {
	const fmt = new Intl.DateTimeFormat("en-US", {
		timeZone: "America/New_York",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23"
	});
	const parts = Object.fromEntries(fmt.formatToParts(new Date(iso)).map((part) => [part.type, part.value]));
	return {
		ymd: `${parts.year}-${parts.month}-${parts.day}`,
		minutes: Number(parts.hour) * 60 + Number(parts.minute)
	};
}
function barStartMinute(iso, ymd) {
	const parts = etParts(iso);
	if (parts.ymd !== ymd) return null;
	return parts.minutes;
}
function evaluateOrb(symbol, bars, nowIso, quote, adjustment) {
	const skip = (reason, rangeHigh = null, rangeLow = null) => ({
		symbol,
		action: "skip",
		reason,
		experimental: true,
		validated: false,
		rangeHigh,
		rangeLow,
		stop: rangeLow,
		close: null
	});
	if (adjustment !== "raw") return skip("Adjusted prices are refused.");
	const now = etParts(nowIso);
	if (now.minutes >= PAPER_RISK.flattenMinute) return {
		symbol,
		action: "flatten",
		reason: "Flatten window, 3:55 PM ET. A fill is not guaranteed.",
		experimental: true,
		validated: false,
		rangeHigh: null,
		rangeLow: null,
		stop: null,
		close: null
	};
	const stamps = bars.map((bar) => bar.t);
	if (new Set(stamps).size !== stamps.length) return skip("Duplicate bars.");
	const today = bars.map((bar) => ({
		bar,
		start: barStartMinute(bar.t, now.ymd)
	})).filter((row) => row.start !== null).sort((a, b) => a.start - b.start);
	const opening = today.find((row) => row.start === 570);
	if (!opening) return skip("The 9:30 ET opening bar is missing.");
	if (!(opening.bar.h >= opening.bar.l) || !(opening.bar.v >= 0)) return skip("The opening bar is not a valid price.");
	const completed = today.filter((row) => {
		return new Date(row.bar.t).getTime() + 9e5 <= new Date(nowIso).getTime();
	});
	const latest = completed[completed.length - 1];
	if (!latest) return skip("No completed bar.", opening.bar.h, opening.bar.l);
	if (new Date(nowIso).getTime() - (new Date(latest.bar.t).getTime() + 9e5) > 18e4) return skip("The latest completed bar is stale.", opening.bar.h, opening.bar.l);
	if (now.minutes >= PAPER_RISK.entryCutoffMinute) return skip("The entry window is closed.", opening.bar.h, opening.bar.l);
	if (latest.bar.v < PAPER_RISK.minBarVolume) return skip("Volume is too thin.", opening.bar.h, opening.bar.l);
	if (!quote) return skip("No quote, so spread and freshness cannot be checked.", opening.bar.h, opening.bar.l);
	const quoteAge = new Date(nowIso).getTime() - new Date(quote.ts).getTime();
	if (!Number.isFinite(quoteAge) || quoteAge > 15e3 || quoteAge < -5e3) return skip("The quote is stale.", opening.bar.h, opening.bar.l);
	const mid = (quote.bid + quote.ask) / 2;
	const spreadBps = mid > 0 ? (quote.ask - quote.bid) / mid * 1e4 : Infinity;
	if (!(quote.ask >= quote.bid) || spreadBps > PAPER_RISK.maxSpreadBps) return skip("The spread is wider than 10 bps.", opening.bar.h, opening.bar.l);
	if (!(latest.bar.c > opening.bar.h)) return skip("No break above the opening range. Shorts are not taken.", opening.bar.h, opening.bar.l);
	return {
		symbol,
		action: "enter_long",
		reason: "Close broke the 15-minute opening range. Experimental only. Not a validated edge.",
		experimental: true,
		validated: false,
		rangeHigh: opening.bar.h,
		rangeLow: opening.bar.l,
		stop: opening.bar.l,
		close: latest.bar.c
	};
}
/** Strategy intent and broker fills are compared. They are not the same ledger. */
function reconcileLedgers(strategy, broker) {
	const notes = [];
	const symbols = /* @__PURE__ */ new Set([...strategy.map((line) => line.symbol), ...broker.map((line) => line.symbol)]);
	for (const symbol of symbols) {
		const intended = strategy.find((line) => line.symbol === symbol)?.qty ?? 0;
		const actual = broker.find((line) => line.symbol === symbol)?.qty ?? 0;
		if (actual < 0) notes.push(`${symbol} is short at the broker.`);
		if (intended !== actual) notes.push(`${symbol}: strategy ledger ${intended}, broker fill ${actual}.`);
	}
	return {
		clean: notes.length === 0,
		notes
	};
}
function parsePaperKeys(keyId, secret) {
	if (typeof keyId !== "string" || typeof secret !== "string") return {
		ok: false,
		reason: "Both the paper key ID and the paper secret are required."
	};
	const id = keyId.trim();
	const sec = secret.trim();
	if (!id || !sec) return {
		ok: false,
		reason: "Both the paper key ID and the paper secret are required."
	};
	if (/\s/.test(id) || /\s/.test(sec)) return {
		ok: false,
		reason: "A key cannot contain spaces or line breaks."
	};
	if (id.startsWith("AK")) return {
		ok: false,
		reason: "That key looks like a live key. Paste the paper key instead."
	};
	if (id.length < 8 || id.length > 128 || sec.length < 8 || sec.length > 256) return {
		ok: false,
		reason: "Those values do not look like an Alpaca paper key pair."
	};
	return {
		ok: true,
		keyId: id,
		secret: sec
	};
}
var STATE_PATH = join(process.cwd(), ".grok", "paper-state.json");
var KEY_PATH = join(process.cwd(), ".grok", "paper-credentials.json");
function emptyState() {
	return {
		launchMode: "MONITORING",
		emergency: false,
		autoApproved: false,
		reconciliationClean: false,
		orders: [],
		strategyQty: [],
		events: [],
		lastAuthenticatedAt: null
	};
}
function loadState() {
	try {
		const parsed = JSON.parse(readFileSync(STATE_PATH, "utf8"));
		if (parsed.launchMode !== "MONITORING" && parsed.launchMode !== "PAPER_MANUAL" && parsed.launchMode !== "PAPER_AUTO") return emptyState();
		return {
			...emptyState(),
			...parsed,
			orders: Array.isArray(parsed.orders) ? parsed.orders : []
		};
	} catch {
		return emptyState();
	}
}
function saveState(state) {
	mkdirSync(join(process.cwd(), ".grok"), { recursive: true });
	writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}
function storedCredentials() {
	if (process.env.APEX_PAPER_KEY_FILE === "off") return null;
	try {
		const parsed = JSON.parse(readFileSync(KEY_PATH, "utf8"));
		const checked = parsePaperKeys(parsed.keyId, parsed.secret);
		return checked.ok ? {
			keyId: checked.keyId,
			secret: checked.secret
		} : null;
	} catch {
		return null;
	}
}
function credentials() {
	const fromEnv = parsePaperKeys(process.env.APCA_API_KEY_ID, process.env.APCA_API_SECRET_KEY);
	if (fromEnv.ok) return {
		keyId: fromEnv.keyId,
		secret: fromEnv.secret
	};
	return storedCredentials();
}
function storeCredentials(keyId, secret) {
	mkdirSync(join(process.cwd(), ".grok"), { recursive: true });
	writeFileSync(KEY_PATH, JSON.stringify({
		keyId,
		secret
	}), { mode: 384 });
}
function fetchTransport(secrets) {
	return { async call({ method, url, body, headers }) {
		assertPaperUrl(url);
		const response = await fetch(url, {
			method,
			headers: {
				accept: "application/json",
				"content-type": "application/json",
				...headers
			},
			body: body === void 0 ? void 0 : JSON.stringify(body),
			signal: AbortSignal.timeout(8e3)
		});
		const text = await response.text();
		let parsed = null;
		if (text) try {
			parsed = JSON.parse(text);
		} catch {
			parsed = { message: "unparsed response" };
		}
		return {
			status: response.status,
			body: JSON.parse(redactSecrets(JSON.stringify(parsed), secrets))
		};
	} };
}
function event(state, text) {
	state.events = [...state.events, {
		ts: (/* @__PURE__ */ new Date()).toISOString(),
		text
	}].slice(-30);
}
async function readPaperDesk() {
	const state = loadState();
	const safety = runPaperSafety();
	const creds = credentials();
	const guard = tradingOriginGuard(process.env.APCA_API_BASE_URL);
	const secrets = creds ? [creds.keyId, creds.secret] : [];
	const base = {
		launchMode: state.launchMode,
		liveSelectable: false,
		connected: false,
		keysStored: Boolean(creds),
		paperAccountConfirmed: false,
		reason: creds ? "Paper credentials are present. Authentication has not succeeded yet." : "No paper key is saved yet. Enter it in Paper key ID and Paper secret. No broker call was authenticated.",
		host: "paper-api.alpaca.markets",
		dataFeed: "unavailable",
		dataNote: "No market-data request was authenticated.",
		streamNote: "Trade and IEX sockets are not open.",
		clock: null,
		lastDataTs: null,
		account: null,
		positions: [],
		orders: state.orders,
		signals: [],
		riskNotes: guard.reason ? [guard.reason] : [],
		events: state.events,
		reconciliationClean: false,
		reconciliationNotes: [],
		emergency: state.emergency,
		safetyPassed: safety.passed,
		safetyFailed: safety.failed,
		dayDrawdown: null,
		minuteEt: null,
		proposal: null
	};
	if (!creds) return base;
	const transport = fetchTransport(secrets);
	try {
		const accountRes = await transport.call({
			method: "GET",
			url: `${PAPER_TRADING_ORIGIN}/v2/account`,
			headers: auth(creds)
		});
		const clockRes = await transport.call({
			method: "GET",
			url: `${PAPER_TRADING_ORIGIN}/v2/clock`,
			headers: auth(creds)
		});
		const posRes = await transport.call({
			method: "GET",
			url: `${PAPER_TRADING_ORIGIN}/v2/positions`,
			headers: auth(creds)
		});
		const ordRes = await transport.call({
			method: "GET",
			url: `${PAPER_TRADING_ORIGIN}/v2/orders?status=all&limit=50`,
			headers: auth(creds)
		});
		if (accountRes.status !== 200) {
			base.reason = `Paper account request returned ${accountRes.status}. This is not a confirmed paper session.`;
			event(state, base.reason);
			saveState(state);
			return {
				...base,
				events: state.events
			};
		}
		const account = parseAccount(accountRes.body);
		if (!account) {
			base.reason = "Paper host returned a body without equity. It was not treated as an account.";
			saveState(state);
			return {
				...base,
				events: state.events
			};
		}
		const clock = parseClock(clockRes.body);
		const minuteEt = clock ? etParts(clock.timestamp).minutes : null;
		const dayDrawdown = account.lastEquity > 0 && account.equityCents < account.lastEquity ? (account.lastEquity - account.equityCents) / account.lastEquity : 0;
		const positions = posRes.status === 200 ? parsePositions(posRes.body) : [];
		const brokerOrders = ordRes.status === 200 ? parseOrders(ordRes.body) : [];
		const recovered = recover(state.orders, brokerOrders);
		const brokerLines = positions.map((row) => ({
			symbol: row.symbol,
			qty: Number(row.qty)
		}));
		const compared = reconcileLedgers(state.strategyQty, brokerLines);
		state.reconciliationClean = posRes.status === 200 && compared.clean;
		state.lastAuthenticatedAt = (/* @__PURE__ */ new Date()).toISOString();
		state.orders = recovered;
		state.strategyQty = filledQtyBySymbol(recovered);
		event(state, "Authenticated paper account read.");
		let signals = [];
		let dataFeed = "unavailable";
		let dataNote = "IEX bars were not authorized.";
		let lastDataTs = clock?.timestamp ?? null;
		if (clock?.isOpen) {
			const barsUrl = `${DATA_ORIGIN}/v2/stocks/bars?symbols=${ORB_SYMBOLS.join(",")}&timeframe=15Min&limit=8&adjustment=raw&feed=iex&sort=desc`;
			const quoteUrl = `${DATA_ORIGIN}/v2/stocks/quotes/latest?symbols=${ORB_SYMBOLS.join(",")}&feed=iex`;
			assertPaperUrl(barsUrl);
			assertPaperUrl(quoteUrl);
			const barsRes = await transport.call({
				method: "GET",
				url: barsUrl,
				headers: auth(creds)
			});
			const quoteRes = await transport.call({
				method: "GET",
				url: quoteUrl,
				headers: auth(creds)
			});
			if (barsRes.status === 200 && quoteRes.status === 200) {
				dataFeed = "iex";
				dataNote = "IEX 15-minute bars and latest quotes. Not the consolidated tape. Unadjusted.";
				signals = buildSignals(barsRes.body, quoteRes.body, clock.timestamp);
				lastDataTs = clock.timestamp;
			} else dataNote = `Market data returned ${barsRes.status}/${quoteRes.status}. No signal was generated.`;
		} else if (clock) dataNote = "The paper clock says the market is closed. No entry signal was generated.";
		saveState(state);
		return {
			...base,
			connected: true,
			paperAccountConfirmed: true,
			reason: account.blocked ? "Paper account is authenticated but blocked at the broker." : "Authenticated against the paper host.",
			dataFeed,
			dataNote,
			streamNote: `Monitor process may open ${DATA_STREAM_URL} and ${TRADE_STREAM_URL}. This read used REST.`,
			clock,
			lastDataTs,
			account,
			positions,
			orders: state.orders,
			signals,
			riskNotes: [...base.riskNotes, ...compared.notes],
			events: state.events,
			reconciliationClean: state.reconciliationClean,
			reconciliationNotes: compared.notes,
			dayDrawdown,
			minuteEt
		};
	} catch (error) {
		const reason = redactSecrets(error instanceof Error ? error.message : "paper read failed", secrets);
		event(state, reason);
		saveState(state);
		return {
			...base,
			reason,
			events: state.events
		};
	}
}
function auth(creds) {
	return {
		"APCA-API-KEY-ID": creds.keyId,
		"APCA-API-SECRET-KEY": creds.secret
	};
}
function parseAccount(body) {
	const row = body;
	if (!row || typeof row.equity !== "string" || typeof row.cash !== "string") return null;
	const equityCents = Math.round(Number(row.equity) * 100);
	const lastEquity = Math.round(Number(row.last_equity ?? row.equity) * 100);
	if (!Number.isFinite(equityCents)) return null;
	return {
		equity: row.equity,
		cash: row.cash,
		buyingPower: typeof row.buying_power === "string" ? row.buying_power : "",
		status: typeof row.status === "string" ? row.status : "",
		blocked: Boolean(row.account_blocked || row.trading_blocked),
		equityCents,
		lastEquity: Number.isFinite(lastEquity) ? lastEquity : equityCents
	};
}
function parseClock(body) {
	const row = body;
	if (!row || typeof row.timestamp !== "string" || typeof row.is_open !== "boolean") return null;
	return {
		timestamp: row.timestamp,
		isOpen: row.is_open
	};
}
function parsePositions(body) {
	if (!Array.isArray(body)) return [];
	return body.flatMap((row) => {
		const item = row;
		if (typeof item.symbol !== "string" || typeof item.qty !== "string") return [];
		return [{
			symbol: item.symbol,
			qty: item.qty,
			avgEntry: String(item.avg_entry_price ?? ""),
			unrealizedPl: String(item.unrealized_pl ?? ""),
			marketValue: String(item.market_value ?? "")
		}];
	});
}
function parseOrders(body) {
	if (!Array.isArray(body)) return [];
	return body.map((row) => orderFromBroker(row));
}
function filledQtyBySymbol(orders) {
	const qty = /* @__PURE__ */ new Map();
	for (const order of orders) {
		if (!order.clientOrderId.startsWith("ax")) continue;
		const signed = order.side === "sell" ? -order.filledQty : order.filledQty;
		qty.set(order.symbol, (qty.get(order.symbol) ?? 0) + signed);
	}
	return [...qty.entries()].map(([symbol, size]) => ({
		symbol,
		qty: size
	}));
}
function recover(local, remote) {
	const byClient = new Map(remote.filter((order) => order.clientOrderId).map((order) => [order.clientOrderId, order]));
	const seen = /* @__PURE__ */ new Set();
	const merged = local.map((order) => {
		const found = byClient.get(order.clientOrderId);
		if (!found) return order;
		seen.add(order.clientOrderId);
		try {
			const state = order.state === found.state ? order.state : transition(order.state, found.state);
			return {
				...found,
				state,
				theoretical: false
			};
		} catch {
			return {
				...order,
				state: "unknown_pending_reconciliation",
				reason: "Local state and the broker disagree. No resubmit."
			};
		}
	});
	for (const order of remote) if (order.clientOrderId.startsWith("ax") && !seen.has(order.clientOrderId)) merged.push(order);
	return merged;
}
function buildSignals(barsBody, quoteBody, nowIso) {
	const bars = barsBody.bars ?? {};
	const quotes = quoteBody.quotes ?? {};
	return ORB_SYMBOLS.map((symbol) => {
		const quote = quotes[symbol];
		const snap = quote && typeof quote.bp === "number" && typeof quote.ap === "number" && typeof quote.t === "string" ? {
			bid: quote.bp,
			ask: quote.ap,
			ts: quote.t
		} : null;
		return evaluateOrb(symbol, bars[symbol] ?? [], nowIso, snap, "raw");
	});
}
async function paperAction(action, extra) {
	const state = loadState();
	const safety = runPaperSafety();
	const creds = credentials();
	const guard = tradingOriginGuard(process.env.APCA_API_BASE_URL);
	if (action === "store-keys") {
		const parsed = parsePaperKeys(extra.keyId, extra.secret);
		if (!parsed.ok) {
			event(state, parsed.reason);
			saveState(state);
			const refused = await readPaperDesk();
			refused.reason = parsed.reason;
			return refused;
		}
		storeCredentials(parsed.keyId, parsed.secret);
		event(state, "Paper key stored on the server. The secret is not written to the event log.");
		saveState(state);
		return readPaperDesk();
	}
	if (action === "disarm") {
		state.launchMode = "MONITORING";
		event(state, "Operator returned the session to monitoring.");
		saveState(state);
		return readPaperDesk();
	}
	if (action === "emergency") {
		state.emergency = true;
		state.launchMode = "MONITORING";
		event(state, "Emergency stop requested. Open orders are cancel-requested. Fills are not guaranteed, and the book is not marked flat.");
		if (creds && !guard.blockOrders) {
			const transport = fetchTransport([creds.keyId, creds.secret]);
			const next = [];
			for (const order of state.orders) next.push(await cancelPaperOrder(transport, creds, order));
			state.orders = next;
		}
		saveState(state);
		return readPaperDesk();
	}
	if (action === "arm-manual" || action === "approve-auto") {
		const desk = await readPaperDesk();
		const facts = {
			safetyPassed: safety.passed,
			paperAccountConfirmed: desk.paperAccountConfirmed,
			reconciliationClean: desk.reconciliationClean,
			operatorApprovedAuto: action === "approve-auto" && extra.phrase === "APPROVE PAPER AUTO"
		};
		const next = promoteLaunch(loadState().launchMode, action === "arm-manual" ? "PAPER_MANUAL" : "PAPER_AUTO", facts);
		const fresh = loadState();
		if (next.ok && action === "approve-auto") fresh.autoApproved = true;
		fresh.launchMode = next.mode;
		event(fresh, next.ok ? `Launch mode is ${next.mode}.` : next.reasons.join(" "));
		saveState(fresh);
		return readPaperDesk();
	}
	if (action === "cancel") {
		if (!creds || !extra.symbol) {
			event(state, "Cancel refused. No confirmed paper key or no client order id.");
			saveState(state);
			return readPaperDesk();
		}
		const target = state.orders.find((row) => row.clientOrderId === extra.symbol);
		if (!target) {
			event(state, "Cancel refused. That client order id is not in this session.");
			saveState(state);
			return readPaperDesk();
		}
		const next = await cancelPaperOrder(fetchTransport([creds.keyId, creds.secret]), creds, target);
		state.orders = state.orders.map((row) => row.clientOrderId === next.clientOrderId ? next : row);
		event(state, `Cancel ${next.clientOrderId} is ${next.state}. ${next.reason}`);
		saveState(state);
		return readPaperDesk();
	}
	if (action === "reconcile") {
		event(state, "Operator requested a fresh paper reconciliation.");
		saveState(state);
		return readPaperDesk();
	}
	if (action === "propose-smoke") {
		const current = await readPaperDesk();
		if (!creds || !current.paperAccountConfirmed) {
			event(loadState(), "Smoke proposal refused. No confirmed paper account.");
			saveState(loadState());
			return readPaperDesk();
		}
		const reasons = [];
		if (!current.clock?.isOpen) reasons.push("Market is closed. No order will be submitted.");
		const quoteUrl = `${DATA_ORIGIN}/v2/stocks/quotes/latest?symbols=SPY&feed=iex`;
		assertPaperUrl(quoteUrl);
		const quoteRes = await fetchTransport([creds.keyId, creds.secret]).call({
			method: "GET",
			url: quoteUrl,
			headers: auth(creds)
		});
		const quote = quoteRes.body?.quotes?.SPY;
		if (quoteRes.status !== 200 || !quote || typeof quote.ap !== "number" || typeof quote.bp !== "number" || typeof quote.t !== "string") reasons.push("Fresh SPY quote was not returned.");
		const ask = quote?.ap ?? 0;
		const bid = quote?.bp ?? 0;
		const spreadBps = ask > 0 ? (ask - bid) / ask * 1e4 : 999;
		if (spreadBps > 10) reasons.push(`Spread is ${spreadBps.toFixed(1)} bps, wider than 10.`);
		if ((quote?.t ? Date.now() - Date.parse(quote.t) : 999999) > 3e4) reasons.push("Quote is older than 30 seconds.");
		const entryCents = Math.round(ask * 100);
		const stopCents = entryCents - 100;
		const equityCents = Math.round(Number(current.account?.equity ?? "0") * 100);
		const cashCents = Math.round(Number(current.account?.cash ?? "0") * 100);
		const sized = sizePaperOrder({
			equityCents,
			cashCents,
			entryPriceCents: entryCents,
			stopPriceCents: stopCents,
			openPositions: current.positions.length,
			entriesToday: 0,
			dayDrawdown: current.dayDrawdown ?? 1,
			minuteEt: current.minuteEt ?? 960,
			side: "buy",
			dataOk: quoteRes.status === 200 && spreadBps <= 10,
			emergency: loadState().emergency || Boolean(current.account?.blocked),
			duplicate: false,
			closing: false
		});
		if (sized.qty < 1) reasons.push(...sized.reasons);
		if (cashCents < entryCents) reasons.push("Cash does not cover one share.");
		const id = `ax${(current.clock?.timestamp ?? (/* @__PURE__ */ new Date()).toISOString()).replace(/[-:TZ.]/g, "").slice(0, 14)}SPYS`.replace(/[^A-Za-z0-9]/g, "").slice(0, 48);
		const proposal = {
			symbol: "SPY",
			side: "buy",
			qty: 1,
			clientOrderId: id,
			entryPriceCents: entryCents,
			stopPriceCents: stopCents,
			notionalCents: entryCents,
			cashCents,
			marketOpen: Boolean(current.clock?.isOpen),
			eligible: reasons.length === 0 && sized.qty >= 1,
			reasons
		};
		const fresh = loadState();
		event(fresh, proposal.eligible ? `Smoke proposal ${id} is ready. One SPY share. Operator confirmation still required.` : `Smoke proposal refused. ${reasons.join(" ")}`);
		saveState(fresh);
		return {
			...await readPaperDesk(),
			proposal
		};
	}
	if (action === "propose-entry") {
		const current = await readPaperDesk();
		if (!creds || !current.paperAccountConfirmed || !extra.symbol) {
			event(loadState(), "Proposal refused. No confirmed paper account or no symbol.");
			saveState(loadState());
			return readPaperDesk();
		}
		const signal = current.signals.find((row) => row.symbol === extra.symbol && row.action === "enter_long");
		const reasons = [];
		if (!current.clock?.isOpen) reasons.push("Market is closed. No order will be submitted.");
		if (current.dataFeed !== "iex") reasons.push("Fresh IEX bars are not available.");
		if (!signal || signal.stop === null || signal.close === null) reasons.push("No eligible entry signal for that symbol.");
		const equityCents = Math.round(Number(current.account?.equity ?? "0") * 100);
		const cashCents = Math.round(Number(current.account?.cash ?? "0") * 100);
		const entry = signal?.close ?? 0;
		const stop = signal?.stop ?? 0;
		const sized = sizePaperOrder({
			equityCents,
			cashCents,
			entryPriceCents: Math.round(entry * 100),
			stopPriceCents: Math.round(stop * 100),
			openPositions: current.positions.length,
			entriesToday: loadState().orders.filter((row) => row.side === "buy" && row.state !== "rejected").length,
			dayDrawdown: current.dayDrawdown ?? 1,
			minuteEt: current.minuteEt ?? 960,
			side: "buy",
			dataOk: current.dataFeed === "iex",
			emergency: loadState().emergency || Boolean(current.account?.blocked),
			duplicate: false,
			closing: false
		});
		if (sized.qty < 1) reasons.push(...sized.reasons, "Risk sized the order to zero.");
		if (cashCents < sized.qty * Math.round(entry * 100)) reasons.push("Available cash is below the proposed notional.");
		const id = `ax${(current.clock?.timestamp ?? (/* @__PURE__ */ new Date()).toISOString()).replace(/[-:TZ.]/g, "").slice(0, 14)}${extra.symbol}P`.replace(/[^A-Za-z0-9]/g, "").slice(0, 48);
		const proposal = {
			symbol: extra.symbol,
			side: "buy",
			qty: sized.qty,
			clientOrderId: id,
			entryPriceCents: Math.round(entry * 100),
			stopPriceCents: Math.round(stop * 100),
			notionalCents: sized.qty * Math.round(entry * 100),
			cashCents,
			marketOpen: Boolean(current.clock?.isOpen),
			eligible: reasons.length === 0 && sized.qty > 0,
			reasons
		};
		const fresh = loadState();
		event(fresh, proposal.eligible ? `Proposal ${id} is ready for operator approval.` : `Proposal refused. ${reasons.join(" ")}`);
		saveState(fresh);
		return {
			...await readPaperDesk(),
			proposal
		};
	}
	if (action === "confirm-entry") {
		const current = await readPaperDesk();
		if (!creds || !current.paperAccountConfirmed || guard.blockOrders || !extra.operatorConfirmed || !extra.symbol) {
			event(loadState(), "Entry refused. Monitoring, missing confirmation, or no confirmed paper account.");
			saveState(loadState());
			return readPaperDesk();
		}
		const signal = current.signals.find((row) => row.symbol === extra.symbol && row.action === "enter_long");
		const fresh = loadState();
		if (!signal || signal.stop === null || signal.close === null) {
			event(fresh, "No entry signal for that symbol. Nothing was sent.");
			saveState(fresh);
			return readPaperDesk();
		}
		if (!current.clock?.isOpen) {
			event(fresh, "Market is closed. The operator confirmation was recorded and no order was sent.");
			saveState(fresh);
			return readPaperDesk();
		}
		const equityCents = Math.round(Number(current.account?.equity ?? "0") * 100);
		const cashCents = Math.round(Number(current.account?.cash ?? "0") * 100);
		const order = await executePaperEntry(fetchTransport([creds.keyId, creds.secret]), creds, {
			symbol: extra.symbol,
			side: "buy",
			entryPriceCents: Math.round(signal.close * 100),
			stopPriceCents: Math.round(signal.stop * 100),
			equityCents,
			cashCents,
			openPositions: current.positions.length,
			entriesToday: fresh.orders.filter((row) => row.side === "buy" && row.state !== "rejected").length,
			dayDrawdown: current.dayDrawdown ?? 1,
			minuteEt: current.minuteEt ?? 960,
			dataOk: current.dataFeed === "iex",
			emergency: fresh.emergency || Boolean(current.account?.blocked),
			duplicate: fresh.orders.some((row) => row.symbol === extra.symbol && ![
				"canceled",
				"rejected",
				"expired",
				"filled"
			].includes(row.state)),
			closing: false,
			closeQty: 0,
			mode: fresh.launchMode,
			operatorConfirmed: true,
			autoApproved: fresh.autoApproved,
			blockOrders: guard.blockOrders
		}, current.clock?.timestamp ?? (/* @__PURE__ */ new Date()).toISOString(), String(fresh.orders.length + 1));
		fresh.orders = [...fresh.orders, order];
		event(fresh, `Paper entry ${order.clientOrderId} is ${order.state}. ${order.reason}`);
		saveState(fresh);
		return readPaperDesk();
	}
	return readPaperDesk();
}
//#endregion
export { paperAction, readPaperDesk };
