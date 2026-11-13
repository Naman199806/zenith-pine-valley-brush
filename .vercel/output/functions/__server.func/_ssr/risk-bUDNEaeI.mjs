import { _ as fmtPct, d as equityCents, f as exposures, l as dailyPnlCents, m as fmtCents, u as drawdown } from "./rolldown-runtime-D7D4PA-g.mjs";
import { Y as require_jsx_runtime } from "../_libs/@tanstack/react-router+[...].mjs";
import { n as Button, r as Panel, t as Banner } from "./ui-DoDCKVnC.mjs";
import { n as useApex } from "./router-BUAwk0jc.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/risk-bUDNEaeI.js
var import_jsx_runtime = require_jsx_runtime();
function Risk() {
	const { book, busy, kill } = useApex();
	const eq = equityCents(book);
	const loss = Math.max(0, -dailyPnlCents(book)) / (book.dayStartEquityCents || 1);
	const dd = drawdown(book);
	const gross = eq > 0 ? exposures(book).grossCents / eq : 0;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "space-y-4",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Banner, {
				tone: "loss",
				children: "The risk officer agent is advice. These limits are the authority. A stop does not contain a gap, a halt, or a disconnect. Flatten requested is not flat."
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "grid gap-4 md:grid-cols-2",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Meter, {
						label: "Daily loss",
						value: loss,
						marks: [{
							at: .005,
							name: "Alert 0.5%"
						}, {
							at: .01,
							name: "Block 1%"
						}],
						display: fmtPct(loss)
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Meter, {
						label: "Drawdown from peak",
						value: dd,
						marks: [{
							at: .05,
							name: "Review 5%"
						}, {
							at: .08,
							name: "Shutdown 8%"
						}],
						display: fmtPct(dd)
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Meter, {
						label: "Gross exposure",
						value: gross,
						marks: [{
							at: .1,
							name: "Strategy cap 10%"
						}, {
							at: .15,
							name: "Factor cap 15%"
						}],
						display: fmtPct(gross)
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Panel, {
						title: "Book limits",
						kicker: "paper-defaults-v1",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("ul", {
							className: "space-y-2 text-sm text-muted",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { children: [
									"Risk per unleveraged trade: 0.25% of equity, about ",
									fmtCents(Math.round(eq * .0025)),
									" today."
								] }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: "No leverage, no naked options, no shorts, no averaging down." }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: "Single strategy cap: 10%. Same-factor add stops at 8% instead of being resized." }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { children: [
									"Credentials: ",
									book.credentials,
									". Data: ",
									book.dataStatus,
									". Reconciliation: ",
									book.reconciliation,
									"."
								] }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { children: [
									"Positions confirmed flat: ",
									String(book.kill.positionsConfirmedFlat),
									"."
								] })
							]
						})
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Panel, {
				title: "Kill switch",
				action: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "font-mono text-xs text-muted",
					children: book.kill.blockNew ? "NEW RISK BLOCKED" : "ARMED"
				}),
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "flex flex-wrap gap-2",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
							tone: "loss",
							disabled: busy,
							onClick: () => void kill("block"),
							children: "Block new orders"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
							disabled: busy,
							onClick: () => void kill("cancel"),
							children: "Request cancels"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
							tone: "loss",
							disabled: busy,
							onClick: () => void kill("flatten"),
							children: "Request flatten"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
							disabled: busy,
							onClick: () => void kill("release-block"),
							children: "Release block"
						})
					]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
					className: "mt-3 text-sm text-muted",
					children: [
						"Cancel requested: ",
						String(book.kill.cancelRequested),
						". Flatten requested: ",
						String(book.kill.flattenRequested),
						". Simulator connected: ",
						String(book.kill.brokerConnected),
						". Confirmed flat: ",
						String(book.kill.positionsConfirmedFlat),
						"."
					]
				})]
			})
		]
	});
}
function Meter({ label, value, display, marks }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Panel, {
		title: label,
		action: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
			className: "font-mono text-sm tabular-nums",
			children: display
		}),
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "h-2 bg-surface-2",
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: `h-2 ${value >= .08 ? "bg-loss" : "bg-brass"}`,
				style: { width: `${Math.min(100, value * 100 * 4)}%` }
			})
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
			className: "mt-3 space-y-1 text-xs text-muted",
			children: marks.map((mark) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { children: [mark.name, value >= mark.at ? " — reached" : ""] }, mark.name))
		})]
	});
}
var SplitComponent = Risk;
//#endregion
export { SplitComponent as component };
