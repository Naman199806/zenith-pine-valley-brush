import { C as quoteOf, S as positionQty, T as strategy, t as __exportAll, v as initialBook, x as notionalCents, y as instrument } from "./rolldown-runtime-D7D4PA-g.mjs";
import { a as validateBars, i as runNoiseWalk, n as applySplits, r as runIllustrativeOrb } from "./backtest-DzOGIrgT.mjs";
import { c as loseAcknowledgement, d as rejectCancel, f as requestCancel, h as sizingPreview, l as promote, m as setMode, n as applyAssignment, o as gapThroughStop, p as setKill, r as applySubmission, s as loadScenario, t as agentTool, u as reconcileOrder } from "./trading-D0fHfFa0.mjs";
import { a as runDesk, i as futuresStress, n as cryptoArb, r as expiryStatus } from "./desk-D3g6HEsC.mjs";
import { n as TSS_SERVER_FUNCTION, t as createServerFn } from "./ssr.mjs";
import { n as cashDividendsInWindow, r as holdingTotalReturn, t as SPRINT3 } from "./sprint3-pGrmd1_H.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/api-BtKtHxFN.js
var createServerRpc = (serverFnMeta, splitImportFn) => {
	const url = "/_serverFn/" + serverFnMeta.id;
	return Object.assign(splitImportFn, {
		url,
		serverFnMeta,
		[TSS_SERVER_FUNCTION]: true
	});
};
/** Paper hosts only. The live trading origin is refused even if an environment variable names it. */
var PAPER_TRADING_ORIGIN = "https://paper-api.alpaca.markets";
var DATA_ORIGIN = "https://data.alpaca.markets";
var DATA_STREAM_URL = "wss://stream.data.alpaca.markets/v2/iex";
var TRADE_STREAM_URL = "wss://paper-api.alpaca.markets/stream";
var HOSTS = /* @__PURE__ */ new Set([
	"paper-api.alpaca.markets",
	"data.alpaca.markets",
	"stream.data.alpaca.markets"
]);
function assertPaperUrl(raw) {
	const url = new URL(raw);
	if (url.protocol !== "https:" && url.protocol !== "wss:") throw new Error("Blocked non-paper URL: only https and wss are allowed.");
	if (url.username || url.password) throw new Error("Blocked URL with embedded credentials.");
	if (!HOSTS.has(url.hostname)) throw new Error(`Blocked host ${url.hostname}. Live trading is not allowed.`);
	if (url.hostname === "paper-api.alpaca.markets") {
		if (!(url.pathname.startsWith("/v2/") || url.pathname === "/stream" || url.pathname.startsWith("/stream/"))) throw new Error("Blocked paper-trading path.");
	}
	if (url.hostname === "data.alpaca.markets" && !url.pathname.startsWith("/v2/stocks/")) throw new Error("Blocked market-data path.");
	if (url.hostname === "stream.data.alpaca.markets" && url.pathname !== "/v2/iex") throw new Error("Blocked market-data stream. SIP is not enabled.");
	return url;
}
/** Environment cannot select the live host. A non-paper base URL blocks order submission. */
function tradingOriginGuard(envBase) {
	if (!envBase?.trim()) return {
		origin: PAPER_TRADING_ORIGIN,
		blockOrders: false,
		reason: null
	};
	let origin = "";
	try {
		origin = new URL(envBase).origin;
	} catch {
		return {
			origin: PAPER_TRADING_ORIGIN,
			blockOrders: true,
			reason: "APCA_API_BASE_URL is not a URL. Orders are blocked."
		};
	}
	if (origin === "https://api.alpaca.markets") return {
		origin: PAPER_TRADING_ORIGIN,
		blockOrders: true,
		reason: "APCA_API_BASE_URL is the live trading host. Orders are blocked."
	};
	if (origin !== "https://paper-api.alpaca.markets") return {
		origin: PAPER_TRADING_ORIGIN,
		blockOrders: true,
		reason: "APCA_API_BASE_URL is not the paper host. Orders are blocked."
	};
	return {
		origin: PAPER_TRADING_ORIGIN,
		blockOrders: false,
		reason: null
	};
}
function redactSecrets(text, secrets) {
	let out = text;
	for (const secret of secrets) if (secret && secret.length > 3) out = out.split(secret).join("[redacted]");
	return out;
}
function promoteLaunch(current, to, facts) {
	if (to === "LIVE" || to === "LIVE_ELIGIBLE" || to === "SHADOW") return {
		ok: false,
		mode: current,
		reasons: ["Live trading is not implemented and cannot be selected."]
	};
	if (to !== "MONITORING" && to !== "PAPER_MANUAL" && to !== "PAPER_AUTO") return {
		ok: false,
		mode: current,
		reasons: ["Unknown launch mode."]
	};
	if (to === "MONITORING") return {
		ok: true,
		mode: "MONITORING",
		reasons: []
	};
	if (to === "PAPER_MANUAL") {
		const reasons = [];
		if (!facts.safetyPassed) reasons.push("Safety checks have not passed.");
		if (!facts.paperAccountConfirmed) reasons.push("The paper account has not been confirmed with an authenticated request.");
		if (reasons.length) return {
			ok: false,
			mode: current,
			reasons
		};
		return {
			ok: true,
			mode: "PAPER_MANUAL",
			reasons: []
		};
	}
	const reasons = [];
	if (current !== "PAPER_MANUAL" && current !== "PAPER_AUTO") reasons.push("Paper auto requires paper manual first.");
	if (!facts.paperAccountConfirmed) reasons.push("The paper account has not been confirmed.");
	if (!facts.reconciliationClean) reasons.push("Broker reconciliation has not succeeded.");
	if (!facts.operatorApprovedAuto) reasons.push("Paper auto needs an explicit operator approval.");
	if (reasons.length) return {
		ok: false,
		mode: current,
		reasons
	};
	return {
		ok: true,
		mode: "PAPER_AUTO",
		reasons: []
	};
}
function maySubmit(mode, operatorConfirmed, autoApproved) {
	if (mode === "MONITORING") return "Monitoring does not send broker orders.";
	if (mode === "PAPER_MANUAL" && !operatorConfirmed) return "The operator has not confirmed this paper order.";
	if (mode === "PAPER_AUTO" && !autoApproved) return "Paper auto is not approved.";
	return null;
}
/** Stricter than the fixture simulator. These limits apply only to the Alpaca paper session. */
var PAPER_RISK = {
	maxRiskFraction: .001,
	maxNotionalFraction: .05,
	maxPositions: 3,
	maxEntriesPerSession: 5,
	blockDrawdown: .005,
	emergencyDrawdown: .01,
	entryCutoffMinute: 900,
	flattenMinute: 955,
	maxSpreadBps: 10,
	minBarVolume: 1e3,
	alpacaCryptoTakerBps: 25,
	alpacaCryptoMakerBps: 15
};
function sizePaperOrder(input) {
	const reasons = [];
	const emergency = input.emergency || input.dayDrawdown >= PAPER_RISK.emergencyDrawdown;
	if (emergency && !input.closing) reasons.push("Emergency stop. Daily drawdown is at 1%, or the operator stopped the session. Liquidation is not guaranteed.");
	if (input.side === "sell" && !input.closing) reasons.push("Short selling is not allowed.");
	if (input.side === "buy" && input.closing) reasons.push("A close must be a sell of an existing long.");
	if (!input.dataOk) reasons.push("Market data is missing, stale, or wider than 10 bps.");
	if (input.duplicate) reasons.push("Duplicate order.");
	if (!(input.cashCents > 0) && !input.closing) reasons.push("No cash is available.");
	if (!input.closing && input.minuteEt >= PAPER_RISK.entryCutoffMinute) reasons.push("No new entries after 3:00 PM ET.");
	if (!input.closing && input.dayDrawdown >= PAPER_RISK.blockDrawdown) reasons.push("New risk is blocked at 0.5% daily drawdown.");
	if (!input.closing && input.openPositions >= PAPER_RISK.maxPositions) reasons.push("Three positions are already open.");
	if (!input.closing && input.entriesToday >= PAPER_RISK.maxEntriesPerSession) reasons.push("Five entries have already been taken today.");
	if (reasons.length) return {
		qty: 0,
		reasons,
		emergency
	};
	if (input.closing) return {
		qty: 0,
		reasons: [],
		emergency
	};
	const riskCents = Math.floor(input.equityCents * PAPER_RISK.maxRiskFraction);
	const stopDist = input.entryPriceCents - input.stopPriceCents;
	if (!(riskCents > 0) || !(stopDist > 0) || !(input.entryPriceCents > 0)) return {
		qty: 0,
		reasons: ["The stop must sit below the entry, and equity has to be positive."],
		emergency
	};
	let qty = Math.floor(riskCents / stopDist);
	const cap = Math.floor(input.equityCents * PAPER_RISK.maxNotionalFraction);
	while (qty > 0 && qty * input.entryPriceCents > cap) qty -= 1;
	while (qty > 0 && qty * input.entryPriceCents > input.cashCents) qty -= 1;
	if (qty < 1) return {
		qty: 0,
		reasons: ["The 0.10% risk budget or the 5% notional cap is smaller than one share."],
		emergency
	};
	return {
		qty,
		reasons: [],
		emergency
	};
}
function runPaperSafety() {
	const failed = [];
	try {
		assertPaperUrl("https://api.alpaca.markets/v2/account");
		failed.push("live host was allowed");
	} catch {}
	try {
		assertPaperUrl("https://paper-api.alpaca.markets/v2/account");
	} catch {
		failed.push("paper account url was blocked");
	}
	try {
		assertPaperUrl("wss://stream.data.alpaca.markets/v2/sip");
		failed.push("SIP stream was allowed");
	} catch {}
	if (!tradingOriginGuard("https://api.alpaca.markets").blockOrders) failed.push("live base URL did not block orders");
	if (sizePaperOrder({
		equityCents: 1e8,
		cashCents: 1e8,
		entryPriceCents: 5e4,
		stopPriceCents: 49e3,
		openPositions: 0,
		entriesToday: 0,
		dayDrawdown: PAPER_RISK.blockDrawdown,
		minuteEt: 600,
		side: "buy",
		dataOk: true,
		emergency: false,
		duplicate: false,
		closing: false
	}).qty !== 0) failed.push("0.5% drawdown did not block");
	if (sizePaperOrder({
		...blockedInput(),
		minuteEt: PAPER_RISK.entryCutoffMinute
	}).qty !== 0) failed.push("3:00 PM ET did not block");
	if (promoteLaunch("MONITORING", "LIVE", goodFacts()).ok) failed.push("live mode was selectable");
	if (promoteLaunch("MONITORING", "PAPER_MANUAL", {
		...goodFacts(),
		paperAccountConfirmed: false
	}).ok) failed.push("manual armed without an account");
	if (promoteLaunch("MONITORING", "PAPER_AUTO", goodFacts()).ok) failed.push("auto skipped manual");
	if (maySubmit("MONITORING", true, true) === null) failed.push("monitoring was allowed to send");
	return {
		passed: failed.length === 0,
		failed
	};
}
function goodFacts() {
	return {
		safetyPassed: true,
		paperAccountConfirmed: true,
		reconciliationClean: true,
		operatorApprovedAuto: true
	};
}
function blockedInput() {
	return {
		equityCents: 1e8,
		cashCents: 1e8,
		entryPriceCents: 5e4,
		stopPriceCents: 49e3,
		openPositions: 0,
		entriesToday: 0,
		dayDrawdown: 0,
		minuteEt: 600,
		side: "buy",
		dataOk: true,
		emergency: false,
		duplicate: false,
		closing: false
	};
}
function duplicateDates(bars) {
	const seen = /* @__PURE__ */ new Set();
	const dupes = [];
	for (const bar of bars) {
		if (seen.has(bar.date)) dupes.push(bar.date);
		seen.add(bar.date);
	}
	return dupes;
}
function missingSymbols(required, present) {
	const have = new Set(present);
	return required.filter((symbol) => !have.has(symbol));
}
/** Dates present on the reference calendar and absent from the other tape. */
function missingSessions(reference, other) {
	const have = new Set(other);
	return reference.filter((date) => !have.has(date));
}
function badSplits(splits) {
	const reasons = [];
	for (const split of splits) {
		if (!split.exDate) reasons.push("split missing ex-date");
		if (!(split.numerator > 0) || !(split.denominator > 0)) reasons.push("split ratio not positive");
	}
	return reasons;
}
function dividendsMissingEx(divs) {
	return divs.filter((div) => !div.exDate).length;
}
/** Same date, different adjusted close, across two vendor vintages. */
function revisedAdjustedClose(earlier, later) {
	const prior = new Map(earlier.map((row) => [row.date, row.adj]));
	const dates = [];
	for (const row of later) {
		const before = prior.get(row.date);
		if (before !== void 0 && before !== row.adj) dates.push(row.date);
	}
	return dates;
}
/** Reasons a research blob must not become an order. Empty only if every gate is clean and the strategy is not sprint 3. */
function researchPayloadBlocks(payload) {
	const reasons = [];
	if (payload.strategyId === "t1-tsmom" || payload.strategyId === "t2-overnight") reasons.push("Sprint 3 is still IDEA and cannot be ordered.");
	if (payload.scored) reasons.push("A scored result is not an order.");
	if (!payload.frozen) reasons.push("Protocol is not frozen.");
	if (!payload.dividendsHaveExTimestamp) reasons.push("A dividend has no ex-timestamp.");
	if (payload.adjustedCloseUsedAsPrice) reasons.push("Adjusted close was used as a price.");
	if (!payload.historyComplete) reasons.push("History is missing.");
	if (!payload.corporateActionsConsistent) reasons.push("Corporate actions are inconsistent.");
	if (!payload.calendarsAligned) reasons.push("Calendars are misaligned.");
	if (!reasons.length && payload.strategyId !== "paper-mechanics") reasons.push("Only plumbing can reach the simulator, and this blob is not plumbing.");
	return reasons;
}
function check(group, id, passed, detail) {
	return {
		group,
		id,
		passed,
		detail
	};
}
function paper() {
	return setMode(initialBook(), "PAPER").book;
}
function replayCash(book, start) {
	let cash = start;
	for (const order of book.orders) for (const fill of order.fills) {
		const notion = notionalCents(fill.priceMicros, fill.qtyMicros);
		if (order.side === "buy") cash -= notion + fill.feeCents;
		else cash += notion - fill.feeCents;
	}
	return cash;
}
function runAcceptance() {
	const checks = [];
	const zero = runIllustrativeOrb(0);
	const base = runIllustrativeOrb(8);
	const stress = runIllustrativeOrb(16);
	const corruptLater = runIllustrativeOrb(8, {
		fromBar: 8,
		delta: 500
	});
	const corruptFill = runIllustrativeOrb(8, {
		fromBar: 7,
		delta: 500
	});
	checks.push(check("backtest", "cost-drag", zero.endingCents > base.endingCents && base.endingCents > stress.endingCents, `0 bps ends ${zero.endingCents}, 8 bps ends ${base.endingCents}, 16 bps ends ${stress.endingCents}.`), check("backtest", "net-loss-after-cost", base.metrics.netReturn < 0 && zero.metrics.netReturn > 0, `Gross return ${zero.metrics.grossReturn}. Net return ${base.metrics.netReturn}.`), check("backtest", "no-lookahead", base.lookaheadSafe && base.trades[0]?.fillPriceCents === 10020 && corruptLater.trades[0]?.fillPriceCents === base.trades[0]?.fillPriceCents && corruptFill.trades[0]?.fillPriceCents !== base.trades[0]?.fillPriceCents, "Entry is the next open. Later bars do not change it."), check("backtest", "zero-variance-not-a-pass", !Number.isFinite(base.metrics.sharpe) && promote("orb-cost-control", "VALIDATED").ok === false, "Identical sessions make Sharpe unusable. The control stays retired."), check("backtest", "noise-not-evidence", runNoiseWalk(8).dataset === "SYNTHETIC_NOISE_V1" && promote("orb-cost-control", "PAPER").ok === false, "Seeded noise cannot revive a retired rule."), check("registry", "sprint-record", strategy("s1-intraday")?.state === "RETIRED" && strategy("s2-holdout")?.state === "RETIRED" && strategy("t1-tsmom")?.state === "IDEA" && strategy("t2-overnight")?.state === "IDEA", "Sprint 1 and 2 stay retired. Sprint 3 stays an idea."), check("registry", "sprint3-unscored", SPRINT3.frozen === false && SPRINT3.scored === false && SPRINT3.auctionCostBps === null && SPRINT3.alpacaCompared === false && SPRINT3.rows.find((r) => r.symbol === "BIL")?.first === "2007-05-30" && SPRINT3.t2CommonStart === "1999-03-10", "Coverage is recorded. No T1 or T2 return was computed."), check("registry", "no-skip", promote("t1-tsmom", "VALIDATED").ok === false && promote("paper-mechanics", "SHADOW").ok === false && promote("paper-mechanics", "LIVE").ok === false, "Gates cannot be skipped and live stays locked."));
	const research = applySubmission(initialBook(), sizingPreview(initialBook(), "SPY"));
	checks.push(check("execution", "research-cannot-fill", research.ok === false && research.order?.state === "rejected" && research.order.fills.length === 0 && research.book.cashCents === 1e8, research.message));
	const live = setMode(initialBook(), "LIVE");
	checks.push(check("execution", "live-locked", live.ok === false && live.book.mode === "RESEARCH", live.message));
	const session = paper();
	const buy = applySubmission(session, sizingPreview(session, "SPY"));
	buy.order && applySubmission(buy.book, sizingPreview(session, "SPY"));
	const dupIntent = sizingPreview(session, "SPY");
	const first = applySubmission(session, {
		...dupIntent,
		idempotencyKey: "same-key"
	});
	const second = applySubmission(first.book, {
		...dupIntent,
		idempotencyKey: "same-key",
		qtyMicros: dupIntent.qtyMicros
	});
	checks.push(check("execution", "paper-fill-not-live", Boolean(first.ok && first.order && first.order.live === false && first.order.mode === "PAPER" && first.order.fills.length === 1 && first.order.strategyVersion === "plumbing-1" && first.order.riskDecisionId.length > 0), first.message), check("execution", "idempotent-key", second.order?.id === first.order?.id && second.book.orders.filter((o) => o.idempotencyKey === "same-key").length === 1 && second.book.orders[0]?.fills.length === 1, "One key, one order, one fill."), check("execution", "ledger-matches-fills", first.book.cashCents === replayCash(first.book, 1e8) && positionQty(first.book, "SPY") === first.order?.filledQtyMicros, `Cash ${first.book.cashCents}.`), check("execution", "rejected-not-a-fill", research.order?.fills.length === 0, "A rejected order has no fill."));
	const unapproved = applySubmission(session, {
		...sizingPreview(session, "SPY"),
		strategyId: "t1-tsmom",
		strategyVersion: "draft-2026-11-11",
		idempotencyKey: "bad-strat"
	});
	const fakePx = applySubmission(session, {
		...sizingPreview(session, "SPY"),
		expectedPriceMicros: 1,
		idempotencyKey: "fake-px"
	});
	const fakeId = applySubmission(session, {
		...sizingPreview(session, "NOPE"),
		instrumentId: "NOPE",
		idempotencyKey: "fake-id"
	});
	const agentOrder = applySubmission(session, {
		...sizingPreview(session, "SPY"),
		actor: "agent",
		idempotencyKey: "agent-order"
	});
	const tool = agentTool(session, "setRiskLimit");
	checks.push(check("risk", "unapproved-strategy", unapproved.ok === false && unapproved.order?.fills.length === 0, unapproved.message), check("risk", "hallucinated-price", fakePx.ok === false, fakePx.message), check("risk", "unknown-instrument", fakeId.ok === false, fakeId.message), check("risk", "agent-cannot-send", agentOrder.ok === false, agentOrder.message), check("risk", "agent-cannot-change-limits", tool.ok === false && tool.book.kill.blockNew === session.kill.blockNew && tool.book.cashCents === session.cashCents, tool.message));
	const stale = applySubmission({
		...session,
		dataStatus: "stale"
	}, {
		...sizingPreview(session, "SPY"),
		idempotencyKey: "stale"
	});
	const halted = applySubmission({
		...session,
		dataStatus: "halted"
	}, {
		...sizingPreview(session, "SPY"),
		idempotencyKey: "halted"
	});
	const broken = applySubmission({
		...session,
		reconciliation: "broken"
	}, {
		...sizingPreview(session, "SPY"),
		idempotencyKey: "broken"
	});
	const expired = applySubmission({
		...session,
		credentials: "expired"
	}, {
		...sizingPreview(session, "SPY"),
		idempotencyKey: "expired"
	});
	const haltedVenue = applySubmission({
		...session,
		withdrawalHalt: ["SIM-CRYPTO"]
	}, {
		...sizingPreview(session, "BTC-USD"),
		instrumentId: "BTC-USD",
		idempotencyKey: "halt-wd"
	});
	const loss = applySubmission(loadScenario("daily-loss"), {
		...sizingPreview(loadScenario("daily-loss"), "SPY"),
		idempotencyKey: "loss"
	});
	checks.push(check("risk", "stale-blocks", stale.ok === false && halted.ok === false, `${stale.message} ${halted.message}`), check("risk", "mismatch-blocks", broken.ok === false, broken.message), check("risk", "expired-key-blocks", expired.ok === false, expired.message), check("risk", "withdrawal-halt", haltedVenue.ok === false, haltedVenue.message), check("risk", "daily-loss-block", loss.ok === false, loss.message), check("risk", "factor-reject", runDesk(session, "correlated").blocked, runDesk(session, "correlated").blockReasons.join(" ")));
	const restingIntent = {
		...sizingPreview(session, "SPY"),
		orderType: "limit",
		limitPriceMicros: 1,
		idempotencyKey: "rest"
	};
	const resting = applySubmission(session, restingIntent);
	const lost = loseAcknowledgement(resting.book, resting.order?.id ?? "");
	const rec = reconcileOrder(lost.book, resting.order?.id ?? "", resting.order?.qtyMicros ?? 0, quoteOf("SPY").askMicros);
	const rec2 = reconcileOrder(rec.book, resting.order?.id ?? "", resting.order?.qtyMicros ?? 0, quoteOf("SPY").askMicros);
	checks.push(check("failure", "lost-ack-no-blind-retry", lost.order?.state === "unknown" && lost.order.fills.length === 0 && lost.order.ackLost === true, lost.message), check("failure", "reconcile-once", rec.order?.fills.length === 1 && rec2.order?.fills.length === 1 && rec.book.cashCents === rec2.book.cashCents, "A second reconcile does not add a fill."));
	const cancel = requestCancel(resting.book, resting.order?.id ?? "");
	const denied = rejectCancel(cancel.book, resting.order?.id ?? "");
	checks.push(check("failure", "cancel-rejected", denied.order?.state === "cancel_rejected" && denied.book.kill.positionsConfirmedFlat === false, denied.message));
	const gap = gapThroughStop(session);
	const stop = gap.order?.stopPriceMicros ?? 0;
	const filled = gap.order?.fills[0]?.priceMicros ?? 0;
	checks.push(check("failure", "gap-worse-than-stop", filled < stop && gap.book.kill.positionsConfirmedFlat === false, gap.message));
	const assigned = applyAssignment(initialBook());
	const spy = assigned.book.positions.find((p) => p.instrumentId === "SPY");
	checks.push(check("failure", "assignment-is-exposure", Boolean(spy && spy.qtyMicros > 0) && assigned.book.positions.some((p) => p.strategyId === "assignment"), assigned.message));
	const open = loadScenario("open-risk");
	const killed = setKill(open, "flatten");
	checks.push(check("failure", "restart-keeps-position", positionQty(structuredClone(open), "SPY") > 0, "A cloned book still has the open position."), check("failure", "kill-does-not-mean-flat", killed.book.kill.flattenRequested && killed.book.kill.positionsConfirmedFlat === false && positionQty(killed.book, "SPY") > 0, killed.message));
	const bars = validateBars([
		{
			ts: "2024-01-02T14:30:00.000Z",
			open: 100,
			high: 101,
			low: 99,
			close: 100,
			volume: 10
		},
		{
			ts: "2024-01-02T14:30:00.000Z",
			open: 100,
			high: 101,
			low: 99,
			close: 100,
			volume: 10
		},
		{
			ts: "2024-01-02T14:00:00.000Z",
			open: 100,
			high: 90,
			low: 110,
			close: 100,
			volume: -1
		}
	]);
	const futureSplit = applySplits([{
		ts: "2024-01-01T00:00:00.000Z",
		open: 200,
		high: 200,
		low: 200,
		close: 200,
		volume: 1
	}], [{
		exTs: "2026-12-01T00:00:00.000Z",
		numerator: 2,
		denominator: 1
	}], "2026-11-11T21:00:00.000Z");
	const divs = [{
		exTs: "2024-06-15T13:30:00.000Z",
		amount: 1
	}, {
		exTs: "2024-12-15T13:30:00.000Z",
		amount: 5
	}];
	const known = cashDividendsInWindow(divs, "2024-01-01T00:00:00.000Z", "2024-07-01T00:00:00.000Z");
	const leaked = cashDividendsInWindow(divs, "2024-01-01T00:00:00.000Z", "2024-12-31T00:00:00.000Z");
	checks.push(check("data", "quarantine", bars.ok.length === 1 && bars.quarantine.length === 2, bars.quarantine.map((q) => q.reason).join(" | ")), check("data", "future-split-ignored", futureSplit[0]?.close === 200, "A split after as-of does not rewrite the bar."), check("data", "future-dividend-ignored", known === 1 && leaked === 6 && holdingTotalReturn(4, 2, known === 1 ? 2 : -1) === 0 && holdingTotalReturn(4, 2, 0) === -.5, "A later ex-date is not income. Omitting the cash dividend understates the holder."), check("data", "expiry-warning", expiryStatus().some((e) => e.id === "CLZ26" && e.warn), expiryStatus().map((e) => e.detail).join(" ")), check("data", "tape-defects", duplicateDates([{
		date: "2024-01-02",
		open: 1,
		high: 1,
		low: 1,
		close: 1,
		volume: 1
	}, {
		date: "2024-01-02",
		open: 1,
		high: 1,
		low: 1,
		close: 1,
		volume: 1
	}]).length === 1 && missingSessions(["2024-01-02", "2024-01-03"], ["2024-01-02"]).join() === "2024-01-03" && badSplits([{
		exDate: null,
		numerator: 2,
		denominator: 0
	}]).length === 2 && dividendsMissingEx([{
		exDate: null,
		amount: 1
	}]) === 1 && revisedAdjustedClose([{
		date: "2024-01-02",
		adj: 10
	}], [{
		date: "2024-01-02",
		adj: 9
	}]).join() === "2024-01-02" && missingSymbols(["SPY", "IWM"], ["SPY"]).join() === "IWM", "Duplicate bars, a missing session, a bad split, a dividend without an ex-date, a revised adjusted close, and a missing symbol are all flagged."));
	const poisoned = researchPayloadBlocks({
		strategyId: "t1-tsmom",
		scored: true,
		frozen: false,
		dividendsHaveExTimestamp: false,
		adjustedCloseUsedAsPrice: true,
		historyComplete: false,
		corporateActionsConsistent: false,
		calendarsAligned: false
	});
	checks.push(check("risk", "research-cannot-become-an-order", poisoned.length >= 6 && !poisoned.some((r) => r.includes("plumbing")) && strategy("t1-tsmom")?.state === "IDEA" && strategy("t2-overnight")?.state === "IDEA" && setMode(initialBook(), "LIVE").book.mode === "RESEARCH", poisoned.join(" ")));
	const deskConflict = runDesk(session, "conflict");
	const arb = cryptoArb();
	const fut = futuresStress();
	checks.push(check("desk", "conflict-blocked", deskConflict.blocked && deskConflict.intent === null && deskConflict.agents.some((a) => a.id === "bull" && a.stance === "support") && deskConflict.agents.some((a) => a.id === "bear" && a.stance === "block"), deskConflict.blockReasons[0] ?? ""), check("desk", "crypto-arb-negative", arb.netBps < 0 && arb.take === false, `Net ${arb.netBps} bps.`), check("desk", "futures-closed", fut.take === false && instrument("MESZ26")?.paperEligible === false, fut.reason), check("desk", "prediction-closed", runDesk(session, "prediction").blocked && instrument("EVT-DEMO")?.contract?.resolutionAmbiguous === true, "Ambiguous resolution stays blocked."), check("desk", "mechanics-needs-paper", runDesk(initialBook(), "mechanics").blocked && runDesk(session, "mechanics").risk?.approved === true, "Research blocks the pipe. Paper can approve a sized ticket."), check("broker", "paper-host-only", runPaperSafety().passed && promoteLaunch("MONITORING", "LIVE", {
		safetyPassed: true,
		paperAccountConfirmed: true,
		reconciliationClean: true,
		operatorApprovedAuto: true
	}).ok === false, runPaperSafety().failed.join(" ") || "Live stays unselectable and the paper allowlist holds."));
	const failed = checks.filter((c) => !c.passed);
	return {
		checks,
		passed: checks.length - failed.length,
		failed: failed.length
	};
}
var api_exports = /* @__PURE__ */ __exportAll({
	acceptanceFn_createServerFn_handler: () => acceptanceFn_createServerFn_handler,
	deskFn_createServerFn_handler: () => deskFn_createServerFn_handler,
	dryRunFn_createServerFn_handler: () => dryRunFn_createServerFn_handler,
	integrationsFn_createServerFn_handler: () => integrationsFn_createServerFn_handler,
	killFn_createServerFn_handler: () => killFn_createServerFn_handler,
	labResultsFn_createServerFn_handler: () => labResultsFn_createServerFn_handler,
	paperActionFn_createServerFn_handler: () => paperActionFn_createServerFn_handler,
	paperDeskFn_createServerFn_handler: () => paperDeskFn_createServerFn_handler,
	researchContributionFn_createServerFn_handler: () => researchContributionFn_createServerFn_handler,
	scenarioFn_createServerFn_handler: () => scenarioFn_createServerFn_handler,
	setModeFn_createServerFn_handler: () => setModeFn_createServerFn_handler,
	submitOrderFn_createServerFn_handler: () => submitOrderFn_createServerFn_handler,
	workflowFn_createServerFn_handler: () => workflowFn_createServerFn_handler
});
var SCENARIOS = [
	"reset",
	"paper",
	"correlated",
	"daily-loss",
	"stale",
	"mismatch",
	"open-risk"
];
function asBook(book) {
	if (!book || book.liveLocked !== true) throw new Error("Book is missing the live lock.");
	if (!Array.isArray(book.orders) || !Array.isArray(book.positions) || !Array.isArray(book.audits)) throw new Error("Book is incomplete.");
	if (book.mode !== "RESEARCH" && book.mode !== "PAPER" && book.mode !== "LIVE") throw new Error("Bad mode.");
	return book;
}
var submitOrderFn_createServerFn_handler = createServerRpc({
	id: "0a2671c4dc67744154eeecb7d67a8131bce70ad6599a490ecef72fd1d6f73339",
	name: "submitOrderFn",
	filename: "src/lib/apex/api.ts"
}, (opts) => submitOrderFn.__executeServer(opts));
var submitOrderFn = createServerFn({ method: "POST" }).validator((input) => {
	asBook(input?.book);
	if (!input.intent?.idempotencyKey || !input.intent.instrumentId) throw new Error("Incomplete order.");
	return input;
}).handler(submitOrderFn_createServerFn_handler, async ({ data }) => applySubmission(data.book, data.intent));
var setModeFn_createServerFn_handler = createServerRpc({
	id: "59bfc7ddd0e7cfdf37ff8cffbe2a2cb238109e4de19007ca59665761e14575d1",
	name: "setModeFn",
	filename: "src/lib/apex/api.ts"
}, (opts) => setModeFn.__executeServer(opts));
var setModeFn = createServerFn({ method: "POST" }).validator((input) => {
	asBook(input?.book);
	if (input.mode !== "RESEARCH" && input.mode !== "PAPER" && input.mode !== "LIVE") throw new Error("Bad mode.");
	return input;
}).handler(setModeFn_createServerFn_handler, async ({ data }) => setMode(data.book, data.mode));
var killFn_createServerFn_handler = createServerRpc({
	id: "3fe10f0d2aa919521a717f386df214288f43bbc6dc03bc21e3ecf9a59c3a8284",
	name: "killFn",
	filename: "src/lib/apex/api.ts"
}, (opts) => killFn.__executeServer(opts));
var killFn = createServerFn({ method: "POST" }).validator((input) => {
	asBook(input?.book);
	return input;
}).handler(killFn_createServerFn_handler, async ({ data }) => setKill(data.book, data.action));
var scenarioFn_createServerFn_handler = createServerRpc({
	id: "71cce74dc8d884cdd48af15b155b0b10ae5bf93e8c740675b87306748cd52ac0",
	name: "scenarioFn",
	filename: "src/lib/apex/api.ts"
}, (opts) => scenarioFn.__executeServer(opts));
var scenarioFn = createServerFn({ method: "POST" }).validator((name) => {
	if (!SCENARIOS.includes(name)) throw new Error("Unknown scenario.");
	return name;
}).handler(scenarioFn_createServerFn_handler, async ({ data }) => loadScenario(data));
var acceptanceFn_createServerFn_handler = createServerRpc({
	id: "c22f3f59a85086fd1de2f0019853fca4cf884268c5666d20f701d8c621a864a9",
	name: "acceptanceFn",
	filename: "src/lib/apex/api.ts"
}, (opts) => acceptanceFn.__executeServer(opts));
var acceptanceFn = createServerFn({ method: "POST" }).validator((input) => input).handler(acceptanceFn_createServerFn_handler, async () => runAcceptance());
var deskFn_createServerFn_handler = createServerRpc({
	id: "2eae1004d7196fe099bf90bac84d7a4b18d1c74236597ec4524db8c2c3a3328f",
	name: "deskFn",
	filename: "src/lib/apex/api.ts"
}, (opts) => deskFn.__executeServer(opts));
var deskFn = createServerFn({ method: "POST" }).validator((input) => {
	asBook(input?.book);
	if (!input.caseId) throw new Error("Missing case.");
	return input;
}).handler(deskFn_createServerFn_handler, async ({ data }) => runDesk(data.book, data.caseId));
var integrationsFn_createServerFn_handler = createServerRpc({
	id: "fa73137cebb549305e5acce71987c25ec080c443cde4457eb660e57fdd69f05d",
	name: "integrationsFn",
	filename: "src/lib/apex/api.ts"
}, (opts) => integrationsFn.__executeServer(opts));
var integrationsFn = createServerFn({ method: "POST" }).handler(integrationsFn_createServerFn_handler, async () => {
	const { integrationHealth } = await import("./registry.server-CI8bG_ZC.mjs");
	return integrationHealth();
});
var labResultsFn_createServerFn_handler = createServerRpc({
	id: "10a14d8203e9756fe9ef1bfdf11f5234a2494b29840ea25b882c6b9d0221963d",
	name: "labResultsFn",
	filename: "src/lib/apex/api.ts"
}, (opts) => labResultsFn.__executeServer(opts));
var labResultsFn = createServerFn({ method: "POST" }).handler(labResultsFn_createServerFn_handler, async () => {
	const { readFileSync, existsSync } = await import("node:fs");
	const { join } = await import("node:path");
	const root = process.cwd();
	const load = (name) => {
		const path = join(root, "research", "lab", name);
		if (!existsSync(path)) return null;
		return JSON.parse(readFileSync(path, "utf8"));
	};
	return {
		backtrader: load("backtrader-spy.json"),
		freqtrade: load("freqtrade-btc.json")
	};
});
var workflowFn_createServerFn_handler = createServerRpc({
	id: "cd48b33ee2b26b3ec5aa931998e196b45d344b6fa216a38fff0c7de2373fc9f6",
	name: "workflowFn",
	filename: "src/lib/apex/api.ts"
}, (opts) => workflowFn.__executeServer(opts));
var workflowFn = createServerFn({ method: "POST" }).handler(workflowFn_createServerFn_handler, async () => {
	const { runUnifiedWorkflow } = await import("./workflow-Dio578_c.mjs");
	return runUnifiedWorkflow();
});
var researchContributionFn_createServerFn_handler = createServerRpc({
	id: "8a9fd6fe1313e07cefdf3b4c1b76cb19af7cbe0147a7ab258a9a200f9df3c28d",
	name: "researchContributionFn",
	filename: "src/lib/apex/api.ts"
}, (opts) => researchContributionFn.__executeServer(opts));
var researchContributionFn = createServerFn({ method: "POST" }).handler(researchContributionFn_createServerFn_handler, async () => {
	const { researchContribution } = await import("./registry.server-CI8bG_ZC.mjs");
	return researchContribution();
});
var paperDeskFn_createServerFn_handler = createServerRpc({
	id: "b7e39fba96c1685740ab8b256d38e53802e4189fde25a6d2129de346e4e67c24",
	name: "paperDeskFn",
	filename: "src/lib/apex/api.ts"
}, (opts) => paperDeskFn.__executeServer(opts));
var paperDeskFn = createServerFn({ method: "POST" }).validator((input) => input ?? {}).handler(paperDeskFn_createServerFn_handler, async () => {
	const { readPaperDesk } = await import("./runtime.server-dJ8WXBI3.mjs");
	return readPaperDesk();
});
var paperActionFn_createServerFn_handler = createServerRpc({
	id: "495586cc56818f88b7a37db8006b3098c688839dc44af72bb55ddca89863b586",
	name: "paperActionFn",
	filename: "src/lib/apex/api.ts"
}, (opts) => paperActionFn.__executeServer(opts));
var paperActionFn = createServerFn({ method: "POST" }).validator((input) => {
	if (!input || ![
		"refresh",
		"disarm",
		"emergency",
		"arm-manual",
		"approve-auto",
		"confirm-entry",
		"store-keys",
		"propose-entry",
		"propose-smoke",
		"cancel",
		"reconcile"
	].includes(input.action)) throw new Error("Unknown paper action.");
	if (input.action === "confirm-entry" && input.operatorConfirmed !== true) throw new Error("Operator confirmation is required.");
	if (input.action === "store-keys" && (typeof input.keyId !== "string" || typeof input.secret !== "string")) throw new Error("Both the paper key ID and the paper secret are required.");
	return input;
}).handler(paperActionFn_createServerFn_handler, async ({ data }) => {
	const { paperAction, readPaperDesk } = await import("./runtime.server-dJ8WXBI3.mjs");
	if (data.action === "refresh") return readPaperDesk();
	return paperAction(data.action, data);
});
var dryRunFn_createServerFn_handler = createServerRpc({
	id: "11995c41e7fcdacc923fe6eb5b55e032454e81369facb92d24890cea9af22328",
	name: "dryRunFn",
	filename: "src/lib/apex/api.ts"
}, (opts) => dryRunFn.__executeServer(opts));
var dryRunFn = createServerFn({ method: "POST" }).handler(dryRunFn_createServerFn_handler, async () => {
	const { readDryRun } = await import("./dryrun.server-BXbUm7Qm.mjs");
	return readDryRun();
});
//#endregion
export { maySubmit as a, DATA_STREAM_URL as c, assertPaperUrl as d, redactSecrets as f, sizePaperOrder as i, PAPER_TRADING_ORIGIN as l, runPaperSafety as n, promoteLaunch as o, tradingOriginGuard as p, PAPER_RISK as r, DATA_ORIGIN as s, api_exports as t, TRADE_STREAM_URL as u };
