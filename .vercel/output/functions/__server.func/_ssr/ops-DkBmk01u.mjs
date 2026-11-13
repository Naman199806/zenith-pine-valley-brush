import { r as expiryStatus } from "./desk-D3g6HEsC.mjs";
import { Y as require_jsx_runtime } from "../_libs/@tanstack/react-router+[...].mjs";
import { n as Button, r as Panel, t as Banner } from "./ui-DoDCKVnC.mjs";
import { n as useApex } from "./router-BUAwk0jc.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/ops-DkBmk01u.js
var import_jsx_runtime = require_jsx_runtime();
var FRAMEWORKS = [
	[
		"QuantConnect LEAN",
		"See Integrations",
		"Apache-2.0. Status is the last launcher run, not this card. The 3-bar check is still not LEAN."
	],
	[
		"TradingAgents",
		"See Integrations",
		"Apache-2.0. A model rating is a hypothesis, not an order."
	],
	[
		"Hermes Agent",
		"See Integrations",
		"MIT. It cannot approve itself or write risk limits."
	],
	[
		"Freqtrade",
		"See Integrations",
		"GPL-3.0-only. Isolated backtest only. Not vendored. Not legal clearance."
	],
	[
		"Backtrader",
		"See Integrations",
		"GPL-3.0-or-later. Two fixture checks. Not a second ledger."
	],
	[
		"Day Trader Skill",
		"See Integrations",
		"MIT at 3d0f4ef. Offline scan and a blocked risk check. Not evidence of profitability."
	]
];
var SCENARIOS = [
	["reset", "Reset"],
	["paper", "Paper session"],
	["correlated", "Long SPY"],
	["daily-loss", "Daily loss"],
	["stale", "Stale quotes"],
	["mismatch", "Broken reconcile"],
	["open-risk", "Flatten while down"]
];
function Ops() {
	const { busy, checks, runChecks, scenario } = useApex();
	const failed = checks?.filter((c) => !c.passed).length ?? 0;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "space-y-4",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Banner, { children: "Paper trading is a separate Alpaca path and starts in monitoring. Live trading is not implemented. The framework list on this page is not the measured status. Open Integrations for the process that actually ran." }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Panel, {
				title: "Acceptance checks",
				kicker: "Same functions as the test suite",
				action: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
					tone: "brass",
					disabled: busy,
					onClick: () => void runChecks(),
					children: "Run checks"
				}),
				children: [checks ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
					className: "mb-3 text-sm",
					children: [
						checks.length - failed,
						" passed, ",
						failed,
						" failed."
					]
				}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "mb-3 text-sm text-muted",
					children: "Not run in this session. The engine tests cover the same checks."
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
					className: "max-h-80 space-y-2 overflow-auto",
					children: (checks ?? []).map((c) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
						className: "grid gap-1 border-b border-line pb-2 text-sm md:grid-cols-[10rem_1fr]",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
							className: c.passed ? "text-gain" : "text-loss",
							children: [
								c.passed ? "pass" : "fail",
								" · ",
								c.id
							]
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "text-muted",
							children: c.detail
						})]
					}, c.id))
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Panel, {
				title: "Failure drills",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "flex flex-wrap gap-2",
					children: SCENARIOS.map(([id, label]) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
						disabled: busy,
						onClick: () => void scenario(id),
						children: label
					}, id))
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "mt-3 text-sm text-muted",
					children: "Loading a scenario replaces the simulated book. It does not touch a broker, because none is connected."
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Panel, {
				title: "Contract expiries",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
					className: "space-y-2 text-sm",
					children: expiryStatus().map((row) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", {
						className: row.warn ? "text-warn" : "text-muted",
						children: row.detail
					}, row.id))
				})
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Panel, {
				title: "Upstream frameworks",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "overflow-x-auto",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("table", {
						className: "w-full min-w-[36rem] text-left text-sm",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("thead", {
							className: "text-xs text-muted",
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
									className: "py-2 font-medium",
									children: "Project"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
									className: "py-2 font-medium",
									children: "State"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
									className: "py-2 font-medium",
									children: "Decision"
								})
							] })
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("tbody", { children: FRAMEWORKS.map((row) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", {
							className: "border-t border-line",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
									className: "py-3",
									children: row[0]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
									className: "py-3 text-warn",
									children: row[1]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
									className: "py-3 text-muted",
									children: row[2]
								})
							]
						}, row[0])) })]
					})
				})
			})
		]
	});
}
var SplitComponent = Ops;
//#endregion
export { SplitComponent as component };
