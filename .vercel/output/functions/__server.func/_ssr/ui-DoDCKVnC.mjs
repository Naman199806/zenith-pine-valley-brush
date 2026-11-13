import { Y as require_jsx_runtime } from "../_libs/@tanstack/react-router+[...].mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/ui-DoDCKVnC.js
var import_jsx_runtime = require_jsx_runtime();
function Panel({ title, kicker, action, children }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
		className: "border border-line bg-surface",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", {
			className: "flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [kicker ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "font-mono text-xs tracking-wide text-brass",
				children: kicker
			}) : null, /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
				className: "text-sm font-medium text-fg",
				children: title
			})] }), action]
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "px-4 py-3",
			children
		})]
	});
}
function Stat({ label, value, hint, tone = "fg" }) {
	const color = {
		fg: "text-fg",
		gain: "text-gain",
		loss: "text-loss",
		warn: "text-warn",
		brass: "text-brass"
	}[tone];
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "border border-line bg-surface px-4 py-3",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-xs text-muted",
				children: label
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: `mt-1 font-mono text-2xl tabular-nums ${color}`,
				children: value
			}),
			hint ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "mt-1 text-xs text-muted",
				children: hint
			}) : null
		]
	});
}
function Banner({ children, tone = "warn" }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
		className: `border-l-2 bg-surface px-4 py-3 text-sm ${tone === "loss" ? "border-loss text-fg" : tone === "brass" ? "border-brass text-fg" : "border-warn text-fg"}`,
		children
	});
}
function Pill({ children, tone = "muted" }) {
	const color = {
		muted: "border-line text-muted",
		brass: "border-brass text-brass",
		loss: "border-loss text-loss",
		gain: "border-gain text-gain",
		warn: "border-warn text-warn"
	}[tone];
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
		className: `inline-flex items-center border px-2 py-1 font-mono text-xs ${color}`,
		children
	});
}
function Button({ children, onClick, disabled, tone = "ghost" }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
		type: "button",
		onClick,
		disabled,
		className: `px-3 py-2 text-sm transition-opacity ${tone === "brass" ? "bg-brass text-brass-ink" : tone === "loss" ? "border border-loss text-loss" : "border border-line text-fg"}`,
		children
	});
}
//#endregion
export { Stat as a, Pill as i, Button as n, Panel as r, Banner as t };
