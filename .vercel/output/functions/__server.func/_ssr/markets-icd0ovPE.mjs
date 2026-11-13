import { i as __toESM } from "../_runtime.mjs";
import { h as fmtMicros, i as QUOTES, r as INSTRUMENTS } from "./rolldown-runtime-D7D4PA-g.mjs";
import { J as require_react, Y as require_jsx_runtime } from "../_libs/@tanstack/react-router+[...].mjs";
import { i as Pill, t as Banner } from "./ui-DoDCKVnC.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/markets-icd0ovPE.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
var FILTERS = [
	"all",
	"etf",
	"crypto",
	"fx",
	"option",
	"future",
	"prediction",
	"commodity"
];
function Markets() {
	const [filter, setFilter] = (0, import_react.useState)("all");
	const [picked, setPicked] = (0, import_react.useState)("SPY");
	const rows = INSTRUMENTS.filter((i) => filter === "all" || i.assetClass === filter || filter === "commodity" && (i.id === "GLD" || i.id === "DBC" || i.id === "GCZ26" || i.id === "CLZ26"));
	const inst = INSTRUMENTS.find((i) => i.id === picked) ?? INSTRUMENTS[0];
	const quote = QUOTES[inst.id];
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "space-y-4",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Banner, { children: "Every row is a model or a fixture. Delayed and live vendor feeds are not connected. A green price would be a lie, so these are labeled." }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "flex gap-2 overflow-x-auto",
				children: FILTERS.map((f) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					type: "button",
					onClick: () => setFilter(f),
					className: `px-3 py-2 text-sm ${filter === f ? "bg-brass text-brass-ink" : "border border-line text-muted"}`,
					children: f
				}, f))
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "grid gap-4 xl:grid-cols-[1fr_18rem]",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "overflow-x-auto border border-line",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("table", {
						className: "w-full min-w-[40rem] text-left text-sm",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("thead", {
							className: "bg-surface text-xs text-muted",
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
									className: "px-3 py-2 font-medium",
									children: "Symbol"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
									className: "px-3 py-2 font-medium",
									children: "Class"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
									className: "px-3 py-2 font-medium",
									children: "Venue"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
									className: "px-3 py-2 font-medium",
									children: "Fixture"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
									className: "px-3 py-2 font-medium",
									children: "Paper"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
									className: "px-3 py-2 font-medium",
									children: "Data"
								})
							] })
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("tbody", { children: rows.map((row) => {
							const q = QUOTES[row.id];
							return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", {
								className: "cursor-pointer border-t border-line",
								onClick: () => setPicked(row.id),
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
										className: "px-3 py-3 font-mono",
										children: row.symbol
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
										className: "px-3 py-3",
										children: row.assetClass
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
										className: "px-3 py-3 text-muted",
										children: row.venueId
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
										className: "px-3 py-3 font-mono tabular-nums",
										children: q ? fmtMicros(q.lastMicros, row.priceDecimals > 4 ? 5 : 2) : "—"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
										className: "px-3 py-3",
										children: row.paperEligible ? "yes" : "no"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
										className: "px-3 py-3 text-muted",
										children: row.dataLabel
									})
								]
							}, row.id);
						}) })]
					})
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("aside", {
					className: "border border-line bg-surface p-4 text-sm",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "font-mono text-xs text-brass",
							children: inst.symbol
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
							className: "mt-1 text-lg",
							children: inst.name
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "mt-3 text-muted",
							children: inst.notes
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("dl", {
							className: "mt-4 space-y-2",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Item, {
									label: "Session",
									value: inst.session
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Item, {
									label: "Currency",
									value: inst.currency
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Item, {
									label: "Lot",
									value: `${inst.lotMicros} micros`
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Item, {
									label: "Tick",
									value: `${inst.tickMicros} micros`
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Item, {
									label: "Multiplier",
									value: String(inst.multiplier)
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Item, {
									label: "Factor",
									value: inst.factor
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Item, {
									label: "Leveraged",
									value: inst.leveraged ? "yes — blocked" : "no"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Item, {
									label: "Live",
									value: "locked"
								}),
								quote ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Item, {
									label: "As of",
									value: quote.exchangeTs
								}) : null,
								inst.contract?.expiry ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Item, {
									label: "Expiry",
									value: inst.contract.expiry
								}) : null,
								inst.contract?.delivery ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Item, {
									label: "Delivery",
									value: inst.contract.delivery
								}) : null,
								inst.contract?.payoff ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Item, {
									label: "Payoff",
									value: inst.contract.payoff
								}) : null
							]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "mt-4",
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Pill, {
								tone: inst.paperEligible ? "brass" : "muted",
								children: inst.paperEligible ? "Paper eligible" : "Model only"
							})
						})
					]
				})]
			})
		]
	});
}
function Item({ label, value }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "grid grid-cols-[6rem_1fr] gap-2",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", {
			className: "text-muted",
			children: label
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", { children: value })]
	});
}
var SplitComponent = Markets;
//#endregion
export { SplitComponent as component };
