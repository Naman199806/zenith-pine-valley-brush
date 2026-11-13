import { i as __toESM } from "../_runtime.mjs";
import { J as require_react, Y as require_jsx_runtime } from "../_libs/@tanstack/react-router+[...].mjs";
import { r as Panel, t as Banner } from "./ui-DoDCKVnC.mjs";
import { i as integrationsFn, l as useServerFn } from "./router-BUAwk0jc.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/integrations-CeFx0Q99.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
function Integrations() {
	const load = useServerFn(integrationsFn);
	const [rows, setRows] = (0, import_react.useState)(null);
	const [error, setError] = (0, import_react.useState)("");
	(0, import_react.useEffect)(() => {
		(async () => {
			try {
				setRows(await load());
			} catch (caught) {
				setError(caught instanceof Error ? caught.message : "The integration report did not load.");
			}
		})();
	}, []);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "space-y-4",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Banner, { children: "One portfolio, one risk engine, one order path. Research engines cannot submit an Alpaca order. TESTED means a process ran. It is not ACTIVE, not INTEGRATED, and not a license clearance. GPL engines still need counsel before distribution." }),
			error ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-sm text-loss",
				children: error
			}) : null,
			(rows ?? []).map((row) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Panel, {
				title: row.name,
				kicker: `${row.status} · ${row.license}`,
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("dl", {
					className: "grid gap-3 text-sm md:grid-cols-2",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Item, {
							label: "Version",
							value: row.version ?? "Unknown"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Item, {
							label: "Process",
							value: row.process
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Item, {
							label: "Last test",
							value: row.lastTest ?? "None"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Item, {
							label: "Capability",
							value: row.activeCapability
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Item, {
							label: "Permissions",
							value: row.permissions
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Item, {
							label: "Runtime",
							value: row.runtime
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Item, {
							label: "Health",
							value: row.health
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Item, {
							label: "Boundary",
							value: row.boundary
						})
					]
				}), row.errors.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "mt-3 text-sm text-warn",
					children: row.errors.join(" ")
				}) : null]
			}, row.id)),
			rows === null && !error ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-sm text-muted",
				children: "Checking installed runtimes."
			}) : null
		]
	});
}
function Item({ label, value }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "min-w-0",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", {
			className: "text-xs text-muted",
			children: label
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", {
			className: "break-words",
			children: value
		})]
	});
}
var SplitComponent = Integrations;
//#endregion
export { SplitComponent as component };
