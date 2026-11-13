import { i as __toESM } from "../_runtime.mjs";
import { h as fmtMicros, r as INSTRUMENTS } from "./rolldown-runtime-D7D4PA-g.mjs";
import { a as evaluateRisk, h as sizingPreview, i as closeIntent } from "./trading-D0fHfFa0.mjs";
import { J as require_react, Y as require_jsx_runtime } from "../_libs/@tanstack/react-router+[...].mjs";
import { i as Pill, n as Button, r as Panel, t as Banner } from "./ui-DoDCKVnC.mjs";
import { n as useApex } from "./router-BUAwk0jc.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/terminal-DIIIr6eS.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
function Terminal() {
	const { book, busy, submit } = useApex();
	const eligible = INSTRUMENTS.filter((i) => i.paperEligible);
	const [symbol, setSymbol] = (0, import_react.useState)("SPY");
	const held = book.positions.find((p) => p.instrumentId === symbol && p.qtyMicros > 0);
	const intent = sizingPreview(book, symbol);
	const decision = evaluateRisk(book, intent);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "space-y-4",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Banner, {
			tone: book.mode === "PAPER" ? "brass" : "warn",
			children: book.mode === "PAPER" ? "Paper simulator only. Fills use the fixture plus 2 bps and are tagged plumbing, not evidence. Live orders cannot be created." : "Research mode. The execution service will reject every order, including this preview."
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "grid gap-4 lg:grid-cols-[18rem_1fr]",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Panel, {
				title: "Ticket",
				kicker: "Execution service",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", {
						className: "block text-xs text-muted",
						htmlFor: "symbol",
						children: "Instrument"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("select", {
						id: "symbol",
						className: "mt-1 w-full border border-line bg-bg px-3 py-2 text-sm",
						value: symbol,
						onChange: (e) => setSymbol(e.target.value),
						children: eligible.map((i) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
							value: i.id,
							children: i.symbol
						}, i.id))
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("dl", {
						className: "mt-3 space-y-1 text-sm",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "flex justify-between gap-2",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", {
									className: "text-muted",
									children: "Requested"
								}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", {
									className: "font-mono",
									children: "250 sh"
								})]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "flex justify-between gap-2",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", {
									className: "text-muted",
									children: "Risk size"
								}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("dd", {
									className: "font-mono",
									children: [decision.adjustedQtyMicros / 1e6, " sh"]
								})]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "flex justify-between gap-2",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", {
									className: "text-muted",
									children: "Stop"
								}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", {
									className: "font-mono",
									children: "2%"
								})]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "flex justify-between gap-2",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", {
									className: "text-muted",
									children: "Key"
								}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", {
									className: "font-mono text-xs",
									children: intent.idempotencyKey
								})]
							})
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-3 text-sm text-muted",
						children: decision.reasons.join(" ")
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "mt-3 flex flex-wrap gap-2",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
							tone: "brass",
							disabled: busy,
							onClick: () => void submit(sizingPreview(book, symbol)),
							children: "Submit buy"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
							disabled: busy || !held,
							onClick: () => held && void submit(closeIntent(book, symbol)),
							children: "Close"
						})]
					})
				]
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Panel, {
				title: "Order lifecycle",
				children: book.orders.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "text-sm text-muted",
					children: "No orders. A rejection will appear here and will not be treated as a fill."
				}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
					className: "space-y-3",
					children: [...book.orders].reverse().map((order) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
						className: "border border-line p-3 text-sm",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "flex flex-wrap items-center gap-2",
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
										className: "font-mono",
										children: order.id
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Pill, {
										tone: order.state === "filled" ? "brass" : order.state === "rejected" || order.state === "cancel_rejected" ? "loss" : "warn",
										children: order.state
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
										className: "text-muted",
										children: [
											order.side,
											" ",
											order.instrumentId
										]
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
										className: "font-mono text-xs text-muted",
										children: order.idempotencyKey
									})
								]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "mt-2 text-muted",
								children: order.rejectReason ?? order.fills[0]?.slippageNote ?? "No fill."
							}),
							order.fills.map((fill) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
								className: "mt-1 font-mono text-xs tabular-nums",
								children: [
									fill.id,
									" · ",
									fill.qtyMicros / 1e6,
									" @ ",
									fmtMicros(fill.priceMicros),
									" · fee ",
									fill.feeCents,
									"¢"
								]
							}, fill.id)),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
								className: "mt-1 text-xs text-muted",
								children: [
									"Strategy ",
									order.strategyId,
									"@",
									order.strategyVersion,
									" · risk ",
									order.riskDecisionId,
									" · live ",
									String(order.live)
								]
							})
						]
					}, order.id))
				})
			})]
		})]
	});
}
var SplitComponent = Terminal;
//#endregion
export { SplitComponent as component };
