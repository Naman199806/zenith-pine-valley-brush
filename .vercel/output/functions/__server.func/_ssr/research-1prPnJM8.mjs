import { i as __toESM } from "../_runtime.mjs";
import { h as sizingPreview } from "./trading-D0fHfFa0.mjs";
import { a as runDesk } from "./desk-D3g6HEsC.mjs";
import { J as require_react, Y as require_jsx_runtime } from "../_libs/@tanstack/react-router+[...].mjs";
import { i as Pill, n as Button, r as Panel, t as Banner } from "./ui-DoDCKVnC.mjs";
import { c as researchContributionFn, l as useServerFn, n as useApex, u as workflowFn } from "./router-BUAwk0jc.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/research-1prPnJM8.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
var CASES = [
	{
		id: "mechanics",
		label: "SPY plumbing"
	},
	{
		id: "correlated",
		label: "QQQ on SPY"
	},
	{
		id: "futures",
		label: "MES future"
	},
	{
		id: "prediction",
		label: "Event contract"
	},
	{
		id: "crypto-arb",
		label: "Crypto gap"
	},
	{
		id: "conflict",
		label: "Bull versus bear"
	}
];
function Research() {
	const { book, busy, review, desk, submit } = useApex();
	const [localId, setLocalId] = (0, import_react.useState)("mechanics");
	const report = desk && desk.caseId === localId ? desk : runDesk(book, localId);
	const loadScan = useServerFn(researchContributionFn);
	const loadWorkflow = useServerFn(workflowFn);
	const [scan, setScan] = (0, import_react.useState)(null);
	const [workflow, setWorkflow] = (0, import_react.useState)(null);
	(0, import_react.useEffect)(() => {
		loadScan().then(setScan).catch(() => setScan(null));
		loadWorkflow().then(setWorkflow).catch(() => setWorkflow(null));
	}, []);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "space-y-4",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Banner, {
				tone: "brass",
				children: "Agents argue from timestamped evidence. They cannot send an order. The risk engine’s decision is the one that counts, and a missing or stale input blocks the ticket."
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Panel, {
				title: "Framework adapters",
				kicker: workflow ? "Consumed by Research" : "Loading",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-sm text-muted",
						children: workflow ? `Adapters invoked. executable=${String(workflow.executable)}. paper-auto=${String(workflow.paperAutoEligible)}. Proposal accepted=${String(workflow.proposalAccepted)}.` : "Workflow adapters have not been read."
					}),
					workflow ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
						className: "mt-2 space-y-1 font-mono text-xs text-muted",
						children: Object.entries(workflow.adapters).map(([id, status]) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { children: [
							id,
							": ",
							status
						] }, id))
					}) : null,
					workflow?.proposalReasons.length ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-2 text-sm text-muted",
						children: workflow.proposalReasons.join(" ")
					}) : null
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Panel, {
				title: "Day-trader scan",
				kicker: "Offline fixture",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-sm text-muted",
						children: scan?.note ?? "The offline scan has not been loaded."
					}),
					scan?.plan ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
						className: "mt-2 text-sm",
						children: [
							"Plan entry ",
							scan.plan.entry,
							" stop ",
							scan.plan.stop,
							" target ",
							scan.plan.target,
							". Risk verdict ",
							scan.riskVerdict ?? "none",
							". Broker invoked: ",
							scan.brokerInvoked ? "yes" : "no",
							". Paper-auto: no."
						]
					}) : null,
					scan?.riskReasons?.length ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
						className: "mt-2 space-y-1 text-sm text-muted",
						children: scan.riskReasons.map((reason) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: reason }, reason))
					}) : null
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "flex flex-wrap gap-2",
				children: CASES.map((c) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					type: "button",
					className: `px-3 py-2 text-sm ${localId === c.id ? "bg-brass text-brass-ink" : "border border-line"}`,
					onClick: () => {
						setLocalId(c.id);
						review(c.id);
					},
					children: c.label
				}, c.id))
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Panel, {
				title: report.title,
				kicker: "Desk",
				action: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Pill, {
					tone: report.blocked ? "loss" : "brass",
					children: report.blocked ? "Blocked" : "Engine approved"
				}),
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-sm",
						children: report.rankNote
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
						className: "mt-3 space-y-1 text-sm text-muted",
						children: report.blockReasons.map((reason) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: reason }, reason))
					}),
					report.intent && report.risk?.approved ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "mt-3",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
							tone: "brass",
							disabled: busy || book.mode !== "PAPER",
							onClick: () => void submit(report.caseId === "mechanics" ? sizingPreview(book, "SPY") : report.intent),
							children: "Send to execution service"
						})
					}) : null
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "grid gap-3 md:grid-cols-2 xl:grid-cols-3",
				children: report.agents.map((agent) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", {
					className: "border border-line bg-surface p-3",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex items-center justify-between gap-2",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
							className: "text-sm",
							children: agent.name
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Pill, {
							tone: agent.stance === "block" || agent.stance === "oppose" ? "loss" : agent.stance === "support" ? "gain" : "muted",
							children: agent.stance
						})]
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-2 text-sm text-muted",
						children: agent.text
					})]
				}, agent.id))
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Panel, {
				title: "Evidence",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
					className: "space-y-2 text-sm",
					children: report.evidence.map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "font-mono text-xs text-brass",
							children: item.id
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
							className: "text-muted",
							children: [
								" · ",
								item.source,
								" · ",
								item.ts
							]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: item.text })
					] }, item.id))
				})
			})
		]
	});
}
var SplitComponent = Research;
//#endregion
export { SplitComponent as component };
