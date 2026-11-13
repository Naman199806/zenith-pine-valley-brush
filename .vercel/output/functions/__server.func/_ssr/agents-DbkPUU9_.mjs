import { t as AGENT_ROSTER } from "./desk-D3g6HEsC.mjs";
import { Y as require_jsx_runtime } from "../_libs/@tanstack/react-router+[...].mjs";
import { r as Panel, t as Banner } from "./ui-DoDCKVnC.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/agents-DbkPUU9_.js
var import_jsx_runtime = require_jsx_runtime();
var ROLE_STATUS = [
	{
		id: "scanner",
		name: "Market scanner",
		status: "RULE_BASED",
		mechanism: "symbol list from local manifests",
		modelCall: false,
		sources: ["research/data manifests"],
		consumed: true,
		note: "Lists SPY, QQQ, IWM, GLD, TLT, BIL, BTC-USD, ETH-USD. No live scan."
	},
	{
		id: "technical",
		name: "Technical analyst",
		status: "RULE_BASED",
		mechanism: "completed daily bars",
		modelCall: false,
		sources: ["Coinbase BTC/ETH", "Yahoo equities"],
		consumed: true,
		note: "Uses completed bars only. The 2026-11-13 bar is excluded."
	},
	{
		id: "fundamental",
		name: "Fundamental analyst",
		status: "IDLE",
		mechanism: "none",
		modelCall: false,
		sources: [],
		consumed: false,
		note: "No filings feed."
	},
	{
		id: "macro",
		name: "Macro analyst",
		status: "IDLE",
		mechanism: "none",
		modelCall: false,
		sources: [],
		consumed: false,
		note: "No macro feed."
	},
	{
		id: "news",
		name: "News and sentiment",
		status: "IDLE",
		mechanism: "none",
		modelCall: false,
		sources: [],
		consumed: false,
		note: "No news or sentiment feed."
	},
	{
		id: "derivatives",
		name: "Derivatives analyst",
		status: "IDLE",
		mechanism: "none",
		modelCall: false,
		sources: [],
		consumed: false,
		note: "No options chain or Greeks."
	},
	{
		id: "bull",
		name: "Bull researcher",
		status: "FIXTURE",
		mechanism: "desk.ts note()",
		modelCall: false,
		sources: ["desk fixture"],
		consumed: false,
		note: "Debate text. Not a model call."
	},
	{
		id: "bear",
		name: "Bear researcher",
		status: "FIXTURE",
		mechanism: "desk.ts note()",
		modelCall: false,
		sources: ["desk fixture"],
		consumed: false,
		note: "Debate text. Not a model call."
	},
	{
		id: "quant",
		name: "Quantitative validator",
		status: "RULE_BASED",
		mechanism: "registry states",
		modelCall: false,
		sources: ["rejected baselines"],
		consumed: true,
		note: "Can reject. Cannot promote."
	},
	{
		id: "pm",
		name: "Portfolio manager",
		status: "RULE_BASED",
		mechanism: "sizing preview",
		modelCall: false,
		sources: ["risk constants"],
		consumed: true,
		note: "Sizes only. Does not send."
	},
	{
		id: "risk",
		name: "Risk officer",
		status: "RULE_BASED",
		mechanism: "evaluateRisk",
		modelCall: false,
		sources: ["risk engine"],
		consumed: true,
		note: "The engine decides. The role cannot waive a block."
	},
	{
		id: "execution",
		name: "Execution planner",
		status: "RULE_BASED",
		mechanism: "paper ticket builder",
		modelCall: false,
		sources: ["archived paper fills"],
		consumed: false,
		note: "Plans only. No broker tool on this desk."
	}
];
var BOUNDARY = [
	"No agent has a broker tool.",
	"No agent can raise a limit, turn on live mode, or rewrite a strategy version.",
	"Prices, balances, and fills come from the ledger and the fixture. A narrative that disagrees is discarded.",
	"Retrieved pages and posts are untrusted. They are not wired into this build.",
	"Model cost on this desk is zero. The notes are deterministic rules, not a sampled model."
];
function Agents() {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "space-y-4",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Banner, { children: "Twelve roles, one boundary. The risk officer can argue. The risk engine decides. Hermes-style scheduling and TradingAgents-style debate are specified as future isolated services. They are not running here, and they would still not be allowed to send orders." }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "grid gap-3 md:grid-cols-2 xl:grid-cols-3",
				children: AGENT_ROSTER.map(([id, name], index) => {
					const row = ROLE_STATUS.find((role) => role.id === id);
					return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", {
						className: "border border-line bg-surface p-4",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
								className: "font-mono text-xs text-brass",
								children: [
									String(index + 1).padStart(2, "0"),
									" · ",
									row?.status ?? "IDLE"
								]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
								className: "mt-1 text-sm",
								children: name
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "mt-2 text-sm text-muted",
								children: row?.note ?? "Idle. No model call."
							})
						]
					}, id);
				})
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Panel, {
				title: "Hard boundary",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
					className: "space-y-2 text-sm",
					children: BOUNDARY.map((line) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", {
						className: "text-muted",
						children: line
					}, line))
				})
			})
		]
	});
}
var SplitComponent = Agents;
//#endregion
export { SplitComponent as component };
