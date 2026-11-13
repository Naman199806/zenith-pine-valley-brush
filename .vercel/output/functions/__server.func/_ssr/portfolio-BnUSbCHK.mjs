import { C as quoteOf, E as unrealizedCents, _ as fmtPct, d as equityCents, f as exposures, h as fmtMicros, m as fmtCents, x as notionalCents, y as instrument } from "./rolldown-runtime-D7D4PA-g.mjs";
import { Y as require_jsx_runtime } from "../_libs/@tanstack/react-router+[...].mjs";
import { r as Panel, t as Banner } from "./ui-DoDCKVnC.mjs";
import { n as useApex } from "./router-BUAwk0jc.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/portfolio-BnUSbCHK.js
var import_jsx_runtime = require_jsx_runtime();
function Portfolio() {
	const { book } = useApex();
	const exp = exposures(book);
	const eq = equityCents(book);
	const open = book.positions.filter((p) => p.qtyMicros !== 0);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "space-y-4",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Banner, {
				tone: "brass",
				children: "Cash is an acceptable position. Allocation follows risk, not a win rate. This book does not use full Kelly, and it does not treat two equity ETFs as unrelated bets."
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "grid gap-4 lg:grid-cols-2",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Panel, {
					title: "Holdings",
					children: open.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
						className: "text-sm text-muted",
						children: [
							"Flat. Equity is ",
							fmtCents(eq),
							", all in simulated cash. Unrealized ",
							fmtCents(unrealizedCents(book)),
							"."
						]
					}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "overflow-x-auto",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("table", {
							className: "w-full text-left text-sm",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("thead", {
								className: "text-xs text-muted",
								children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
										className: "py-2 font-medium",
										children: "Instrument"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
										className: "py-2 font-medium",
										children: "Qty"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
										className: "py-2 font-medium",
										children: "Avg"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
										className: "py-2 font-medium",
										children: "Value"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
										className: "py-2 font-medium",
										children: "Strategy"
									})
								] })
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("tbody", { children: open.map((p) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", {
								className: "border-t border-line font-mono tabular-nums",
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
										className: "py-2",
										children: p.instrumentId
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: (p.qtyMicros / 1e6).toLocaleString("en-US") }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: fmtMicros(p.avgPriceMicros) }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: fmtCents(notionalCents(quoteOf(p.instrumentId)?.lastMicros ?? 0, p.qtyMicros)) }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: p.strategyId })
								]
							}, `${p.instrumentId}-${p.strategyId}`)) })]
						})
					})
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Panel, {
					title: "Factor exposure",
					children: exp.byFactor.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-sm text-muted",
						children: "No factor exposure. The 15% same-factor cap is idle."
					}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
						className: "space-y-3",
						children: exp.byFactor.map((row) => {
							const pct = eq > 0 ? row.grossCents / eq : 0;
							return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
									className: "flex justify-between text-sm",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: row.key }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
										className: "font-mono tabular-nums",
										children: fmtPct(pct)
									})]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
									className: "mt-1 h-2 bg-surface-2",
									children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
										className: "h-2 bg-brass",
										style: { width: `${Math.min(100, pct * 100)}%` }
									})
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
									className: "mt-1 text-xs text-muted",
									children: [
										"Gross ",
										fmtCents(row.grossCents),
										" · net ",
										fmtCents(row.netCents)
									]
								})
							] }, row.key);
						})
					})
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Panel, {
				title: "What is not diversification",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("ul", {
					className: "space-y-2 text-sm text-muted",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: "SPY and QQQ share us-equity-beta. Holding both can still be one bet. The engine rejects a same-factor add once that factor is 8% of equity." }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: "GLD is an equity-listed fund. GCZ26 is a deliverable future. They are different instruments, and only GLD is paper-eligible." }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: instrument("EVT-DEMO")?.notes })
					]
				})
			})
		]
	});
}
var SplitComponent = Portfolio;
//#endregion
export { SplitComponent as component };
