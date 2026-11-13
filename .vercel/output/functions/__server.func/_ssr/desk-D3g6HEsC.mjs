import { C as quoteOf, n as AS_OF, y as instrument } from "./rolldown-runtime-D7D4PA-g.mjs";
import { a as evaluateRisk, h as sizingPreview, s as loadScenario } from "./trading-D0fHfFa0.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/desk-D3g6HEsC.js
var AGENT_ROSTER = [
	["scanner", "Market scanner"],
	["technical", "Technical analyst"],
	["fundamental", "Fundamental analyst"],
	["macro", "Macro analyst"],
	["news", "News and sentiment"],
	["derivatives", "Derivatives analyst"],
	["bull", "Bull researcher"],
	["bear", "Bear researcher"],
	["quant", "Quantitative validator"],
	["pm", "Portfolio manager"],
	["risk", "Risk officer"],
	["execution", "Execution planner"]
];
function note(id, stance, text, evidenceIds) {
	return {
		id,
		name: AGENT_ROSTER.find((a) => a[0] === id)?.[1] ?? id,
		stance,
		text,
		evidenceIds
	};
}
function cryptoArb() {
	return {
		grossBps: 12,
		feeBps: 8,
		networkBps: 5,
		withdrawalBps: 4,
		netBps: -5,
		take: false
	};
}
function futuresStress() {
	return {
		symbol: "MESZ26",
		stressLossCents: 1e5,
		budgetCents: 25e4,
		take: false,
		reason: "Stressed loss fits inside 0.25% on a $1,000,000 book, and the ticket is still rejected. Futures are leveraged, the adapter is not open, and a higher theoretical return does not waive the rule."
	};
}
function runDesk(book, caseId) {
	const ev = (id, source, text) => ({
		id,
		ts: AS_OF,
		source,
		text
	});
	if (caseId === "crypto-arb") {
		const arb = cryptoArb();
		return {
			caseId,
			title: "Crypto cross-venue sketch",
			blocked: true,
			blockReasons: ["Net of fees, network, and withdrawal is negative."],
			rankNote: "Rejected on execution cost. The gross spread is not the trade.",
			evidence: [ev("ev-arb", "cost-model", `Gross ${arb.grossBps} bps. Fees ${arb.feeBps}. Network ${arb.networkBps}. Withdrawal ${arb.withdrawalBps}. Net ${arb.netBps} bps.`)],
			risk: null,
			intent: null,
			agents: [
				note("scanner", "neutral", "Two spot venues show a raw gap. No exchange is connected.", ["ev-arb"]),
				note("technical", "neutral", "No trend claim. This is a locked spread.", ["ev-arb"]),
				note("fundamental", "neutral", "No issuer fundamentals on a coin transfer.", ["ev-arb"]),
				note("macro", "neutral", "Not a macro trade.", ["ev-arb"]),
				note("news", "neutral", "No timestamped news item is attached.", ["ev-arb"]),
				note("derivatives", "neutral", "Spot transfer. Funding is not part of this sketch.", ["ev-arb"]),
				note("bull", "oppose", "The raw gap is 12 bps. That is not enough.", ["ev-arb"]),
				note("bear", "block", "Costs are 17 bps. The sketch loses money if it fills.", ["ev-arb"]),
				note("quant", "block", "After-cost expectancy is negative. Stop.", ["ev-arb"]),
				note("pm", "block", "Cash is better than a negative-spread transfer.", ["ev-arb"]),
				note("risk", "block", "Advisory block. Inventory, chain finality, and withdrawal halt are unmodeled.", ["ev-arb"]),
				note("execution", "block", "No order. A planner does not submit.", ["ev-arb"])
			]
		};
	}
	if (caseId === "futures") {
		const f = futuresStress();
		const evidence = [ev("ev-mes", "contract-spec", f.reason)];
		return {
			caseId,
			title: "Index future versus the risk budget",
			blocked: true,
			blockReasons: [f.reason],
			rankNote: "Higher theoretical return does not outrank a closed derivatives gate.",
			evidence,
			risk: null,
			intent: null,
			agents: roster(evidence[0].id, "block", "MESZ26 is a leveraged future. The index itself is not an order.")
		};
	}
	if (caseId === "prediction") return {
		caseId,
		title: "Event contract with a disputed resolution",
		blocked: true,
		blockReasons: ["Settlement is ambiguous. Apparent expected value is not enough."],
		rankNote: "Positive model edge is ignored when the contract might not pay the modeled outcome.",
		evidence: [ev("ev-event", "resolution-policy", "Model probability 0.55 versus a 0.42 contract. Resolution source is disputed. Ambiguity flag is set.")],
		risk: null,
		intent: null,
		agents: roster("ev-event", "block", "Do not trade a contract whose resolution can be argued.")
	};
	if (caseId === "conflict") {
		const evidence = [ev("ev-bull", "fixture", "SPY fixture is fresh. That is not a forecast."), ev("ev-bear", "registry", "No validated strategy. Sprint 1 and 2 were retired without a reconstructed edge.")];
		const intent = {
			...sizingPreview(book, "SPY"),
			strategyId: "t1-tsmom",
			strategyVersion: "draft-2026-11-11",
			actor: "agent"
		};
		const risk = evaluateRisk(book, intent);
		return {
			caseId,
			title: "Bull and bear disagree",
			blocked: true,
			blockReasons: risk.reasons,
			rankNote: "The risk engine, not the louder agent, decides. This ticket is blocked.",
			evidence,
			risk,
			intent: null,
			agents: [
				note("scanner", "neutral", "SPY is liquid in the fixture set.", ["ev-bull"]),
				note("technical", "support", "Price is above an arbitrary fixture level. This is not a signal.", ["ev-bull"]),
				note("fundamental", "neutral", "No statements loaded.", ["ev-bear"]),
				note("macro", "neutral", "No release calendar loaded.", ["ev-bear"]),
				note("news", "neutral", "No article passed the timestamp check.", ["ev-bear"]),
				note("derivatives", "neutral", "No listed hedge is attached.", ["ev-bear"]),
				note("bull", "support", "The strongest case is liquidity. There is still no tested edge.", ["ev-bull"]),
				note("bear", "block", "Retired intraday work failed after costs. A draft ETF protocol is not permission to trade.", ["ev-bear"]),
				note("quant", "block", "No out-of-sample net expectancy on record.", ["ev-bear"]),
				note("pm", "block", "Leave it in cash.", ["ev-bear"]),
				note("risk", "block", "Advisory block. The deterministic engine is the authority.", ["ev-bear"]),
				note("execution", "block", "An agent prepared a ticket and is not allowed to send it.", ["ev-bear"])
			]
		};
	}
	if (caseId === "correlated") {
		const base = loadScenario("correlated");
		const evidence = [ev("ev-corr", "exposure", "Book is long 160 SPY. SPY and QQQ share us-equity-beta. The add is rejected instead of resized.")];
		const intent = {
			...sizingPreview(base, "QQQ"),
			idempotencyKey: "corr-qqq"
		};
		const risk = evaluateRisk(base, intent);
		return {
			caseId,
			title: "QQQ on top of SPY",
			blocked: !risk.approved,
			blockReasons: risk.reasons,
			rankNote: "A liquid ETF can still be the wrong trade once the book already holds the same factor.",
			evidence,
			risk,
			intent: risk.approved ? intent : null,
			agents: roster("ev-corr", "block", "Do not add QQQ just because the fixture is fresh.")
		};
	}
	const evidence = [ev("ev-plumbing-not-alpha", "policy", "Paper plumbing checks the order path. A fill is not a research result."), ev("ev-quote-spy", "fixture", `SPY fixture last ${quoteOf("SPY")?.lastMicros ?? 0} micros as of ${AS_OF}. Source: internal fixture.`)];
	const intent = sizingPreview(book, "SPY");
	const risk = evaluateRisk(book, intent);
	const blocked = !risk.approved;
	return {
		caseId: "mechanics",
		title: "SPY paper plumbing",
		blocked,
		blockReasons: risk.reasons,
		rankNote: blocked ? "Not ranked as an opportunity. The ticket is only a pipe test, and the pipe is currently closed." : "Approved only as plumbing. Expected return is not estimated. Do not read the fill as an edge.",
		evidence,
		risk,
		intent: blocked ? null : intent,
		agents: [
			note("scanner", "neutral", "SPY is on the paper list. The quote is a fixture.", ["ev-quote-spy"]),
			note("technical", "neutral", "No signal is being claimed.", ["ev-plumbing-not-alpha"]),
			note("fundamental", "neutral", "No filings loaded for this ticket.", ["ev-plumbing-not-alpha"]),
			note("macro", "neutral", "No macro input.", ["ev-plumbing-not-alpha"]),
			note("news", "neutral", "No news item. Nothing to deduplicate.", ["ev-plumbing-not-alpha"]),
			note("derivatives", "neutral", "Cash ETF. No Greeks.", ["ev-plumbing-not-alpha"]),
			note("bull", "neutral", "There is no bull case. The order tests buying power and caps.", ["ev-plumbing-not-alpha"]),
			note("bear", "oppose", "Treat any fill as cost, not skill.", ["ev-plumbing-not-alpha"]),
			note("quant", "block", "This strategy has no hypothesis and cannot be promoted.", ["ev-plumbing-not-alpha"]),
			note("pm", "neutral", "Size stays inside the 10% cap if the risk engine allows it.", ["ev-quote-spy"]),
			note("risk", risk.approved ? "neutral" : "block", risk.approved ? "Advisory: allow a reduced plumbing ticket. The engine still has to agree." : `Advisory: ${risk.reasons[0]}`, ["ev-plumbing-not-alpha"]),
			note("execution", "neutral", "Planner can draft a market buy. Only the execution service can submit it, and only after this risk decision.", ["ev-quote-spy"])
		]
	};
}
function roster(evidenceId, stance, text) {
	return AGENT_ROSTER.map(([id]) => note(id, id === "bull" ? "oppose" : stance, text, [evidenceId]));
}
function expiryStatus(now = AS_OF) {
	const nowMs = Date.parse(now);
	return [
		"MESZ26",
		"GCZ26",
		"CLZ26"
	].map((id) => {
		const expiry = instrument(id)?.contract?.expiry;
		if (!expiry) return {
			id,
			days: 999,
			warn: false,
			detail: "No expiry on file."
		};
		const days = Math.round((Date.parse(`${expiry}T00:00:00.000Z`) - nowMs) / 864e5);
		const warn = days <= 14;
		return {
			id,
			days,
			warn,
			detail: warn ? `${id} expires in ${days} days. No automatic roll.` : `${id} expiry ${expiry}. No automatic roll.`
		};
	});
}
//#endregion
export { runDesk as a, futuresStress as i, cryptoArb as n, expiryStatus as r, AGENT_ROSTER as t };
