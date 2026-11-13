import { i as __toESM } from "../_runtime.mjs";
import { _ as fmtPct, d as equityCents, l as dailyPnlCents, m as fmtCents, t as __exportAll, u as drawdown, v as initialBook } from "./rolldown-runtime-D7D4PA-g.mjs";
import { J as require_react, W as isRedirect, Y as require_jsx_runtime, _ as lazyRouteComponent, b as Link, d as Scripts, f as HeadContent, g as Outlet, h as createRouter, p as useRouterState, v as createFileRoute, x as useRouter, y as createRootRoute } from "../_libs/@tanstack/react-router+[...].mjs";
import { n as TSS_SERVER_FUNCTION, r as getServerFnById, t as createServerFn } from "./ssr.mjs";
import { t as TriangleAlert } from "../_libs/lucide-react.mjs";
import { a as union, i as string, n as number, r as object, t as literal } from "../_libs/zod.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/api-h5AEWiDM.js
var import_react = /* @__PURE__ */ __toESM(require_react());
function useServerFn(serverFn) {
	const router = useRouter();
	return import_react.useCallback(async (...args) => {
		try {
			const res = await serverFn(...args);
			if (isRedirect(res)) throw res;
			return res;
		} catch (err) {
			if (isRedirect(err)) {
				err.options._fromLocation = router.stores.location.get();
				return router.navigate(router.resolveRedirect(err).options);
			}
			throw err;
		}
	}, [router, serverFn]);
}
var createSsrRpc = (functionId) => {
	const url = "/_serverFn/" + functionId;
	const serverFnMeta = { id: functionId };
	const fn = async (...args) => {
		return (await getServerFnById(functionId, { origin: "server" }))(...args);
	};
	return Object.assign(fn, {
		url,
		serverFnMeta,
		[TSS_SERVER_FUNCTION]: true
	});
};
var SCENARIOS = [
	"reset",
	"paper",
	"correlated",
	"daily-loss",
	"stale",
	"mismatch",
	"open-risk"
];
function asBook(book) {
	if (!book || book.liveLocked !== true) throw new Error("Book is missing the live lock.");
	if (!Array.isArray(book.orders) || !Array.isArray(book.positions) || !Array.isArray(book.audits)) throw new Error("Book is incomplete.");
	if (book.mode !== "RESEARCH" && book.mode !== "PAPER" && book.mode !== "LIVE") throw new Error("Bad mode.");
	return book;
}
var submitOrderFn = createServerFn({ method: "POST" }).validator((input) => {
	asBook(input?.book);
	if (!input.intent?.idempotencyKey || !input.intent.instrumentId) throw new Error("Incomplete order.");
	return input;
}).handler(createSsrRpc("0a2671c4dc67744154eeecb7d67a8131bce70ad6599a490ecef72fd1d6f73339"));
var setModeFn = createServerFn({ method: "POST" }).validator((input) => {
	asBook(input?.book);
	if (input.mode !== "RESEARCH" && input.mode !== "PAPER" && input.mode !== "LIVE") throw new Error("Bad mode.");
	return input;
}).handler(createSsrRpc("59bfc7ddd0e7cfdf37ff8cffbe2a2cb238109e4de19007ca59665761e14575d1"));
var killFn = createServerFn({ method: "POST" }).validator((input) => {
	asBook(input?.book);
	return input;
}).handler(createSsrRpc("3fe10f0d2aa919521a717f386df214288f43bbc6dc03bc21e3ecf9a59c3a8284"));
var scenarioFn = createServerFn({ method: "POST" }).validator((name) => {
	if (!SCENARIOS.includes(name)) throw new Error("Unknown scenario.");
	return name;
}).handler(createSsrRpc("71cce74dc8d884cdd48af15b155b0b10ae5bf93e8c740675b87306748cd52ac0"));
var acceptanceFn = createServerFn({ method: "POST" }).validator((input) => input).handler(createSsrRpc("c22f3f59a85086fd1de2f0019853fca4cf884268c5666d20f701d8c621a864a9"));
var deskFn = createServerFn({ method: "POST" }).validator((input) => {
	asBook(input?.book);
	if (!input.caseId) throw new Error("Missing case.");
	return input;
}).handler(createSsrRpc("2eae1004d7196fe099bf90bac84d7a4b18d1c74236597ec4524db8c2c3a3328f"));
var integrationsFn = createServerFn({ method: "POST" }).handler(createSsrRpc("fa73137cebb549305e5acce71987c25ec080c443cde4457eb660e57fdd69f05d"));
var labResultsFn = createServerFn({ method: "POST" }).handler(createSsrRpc("10a14d8203e9756fe9ef1bfdf11f5234a2494b29840ea25b882c6b9d0221963d"));
var workflowFn = createServerFn({ method: "POST" }).handler(createSsrRpc("cd48b33ee2b26b3ec5aa931998e196b45d344b6fa216a38fff0c7de2373fc9f6"));
var researchContributionFn = createServerFn({ method: "POST" }).handler(createSsrRpc("8a9fd6fe1313e07cefdf3b4c1b76cb19af7cbe0147a7ab258a9a200f9df3c28d"));
var paperDeskFn = createServerFn({ method: "POST" }).validator((input) => input ?? {}).handler(createSsrRpc("b7e39fba96c1685740ab8b256d38e53802e4189fde25a6d2129de346e4e67c24"));
var paperActionFn = createServerFn({ method: "POST" }).validator((input) => {
	if (!input || ![
		"refresh",
		"disarm",
		"emergency",
		"arm-manual",
		"approve-auto",
		"confirm-entry",
		"store-keys",
		"propose-entry",
		"propose-smoke",
		"cancel",
		"reconcile"
	].includes(input.action)) throw new Error("Unknown paper action.");
	if (input.action === "confirm-entry" && input.operatorConfirmed !== true) throw new Error("Operator confirmation is required.");
	if (input.action === "store-keys" && (typeof input.keyId !== "string" || typeof input.secret !== "string")) throw new Error("Both the paper key ID and the paper secret are required.");
	return input;
}).handler(createSsrRpc("495586cc56818f88b7a37db8006b3098c688839dc44af72bb55ddca89863b586"));
var dryRunFn = createServerFn({ method: "POST" }).handler(createSsrRpc("11995c41e7fcdacc923fe6eb5b55e032454e81369facb92d24890cea9af22328"));
//#endregion
//#region node_modules/.nitro/vite/services/ssr/assets/router-BUAwk0jc.js
var import_jsx_runtime = require_jsx_runtime();
var FALLBACK_MESSAGE = "An unexpected error occurred. Try reloading the page.";
function errorMessage(error) {
	if (error instanceof Error && error.message) return error.message;
	if (typeof error === "string" && error) return error;
	return FALLBACK_MESSAGE;
}
function AppErrorComponent({ error }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("main", {
		className: "flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "text-red-500",
				"aria-hidden": "true",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TriangleAlert, {
					className: "size-10",
					strokeWidth: 2
				})
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
				className: "text-lg font-semibold",
				children: "Something went wrong"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "max-w-md text-sm break-words text-zinc-500 dark:text-zinc-400",
				children: errorMessage(error)
			})
		]
	});
}
/**
* Path-based preview hosts serve the dev server under `/{port_id}/` and strip
* that prefix before forwarding, so SSR sees `/` while the browser URL keeps the
* prefix. TanStack Start resets `basepath` on hydration, so a `rewrite` keeps
* client routing and generated links aligned with the public URL.
*/
var PATH_BASED_PREVIEW_HOSTS = /* @__PURE__ */ new Set([
	"preview.grok.genai.mil",
	"preview.grok.mil",
	"preview.grokgsac.com"
]);
var PORT_ID_PREFIX = /^\/hds-[a-z0-9]+-\d+-[a-z0-9]+(?=\/|$)/i;
function previewPathPrefix(hostname, pathname) {
	if (!PATH_BASED_PREVIEW_HOSTS.has(hostname.toLowerCase())) return void 0;
	return PORT_ID_PREFIX.exec(pathname)?.[0];
}
function prefixRewrite(prefix) {
	return {
		input: ({ url }) => {
			if (url.pathname === prefix) url.pathname = "/";
			else if (url.pathname.startsWith(`${prefix}/`)) url.pathname = url.pathname.slice(prefix.length);
			return url;
		},
		output: ({ url }) => {
			url.pathname = `${prefix}${url.pathname}`;
			return url;
		}
	};
}
function previewPathRewrite() {
	if (typeof window === "undefined") return void 0;
	const prefix = previewPathPrefix(window.location.hostname, window.location.pathname);
	return prefix ? prefixRewrite(prefix) : void 0;
}
/**
* App-wide client provider mounted once near the root (in `src/routes/__root.tsx`):
*
*   <AuthProvider><Outlet /></AuthProvider>
*
* Better Auth's React client (`@/lib/auth/client`) needs NO context provider —
* its `useSession()` works standalone — so this is a passthrough today. It's
* kept as the single, stable mount point for any future client-side providers
* (e.g. a toast or theme provider) without churning the root shell.
*/
function AuthProvider({ children }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_jsx_runtime.Fragment, { children });
}
var CONNECTOR_TOKEN_READY_EVENT = "grok:connector-token-ready";
function isGrokEmbedderOrigin(origin) {
	try {
		const url = new URL(origin);
		if (url.protocol !== "https:" && url.protocol !== "http:") return false;
		const host = url.hostname.toLowerCase();
		if (host === "grok.com" || host.endsWith(".grok.com")) return true;
		if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") return true;
		return false;
	} catch {
		return false;
	}
}
function isSandboxPreviewGuestHost(hostname) {
	const host = hostname.toLowerCase();
	return host === "grok-sandbox.com" || host.endsWith(".grok-sandbox.com");
}
function isRemintPreviewPair(guestHost, parentHost) {
	const guest = guestHost.toLowerCase();
	const parent = parentHost.toLowerCase();
	const i = guest.indexOf(".preview.");
	if (i <= 0) return false;
	const label = guest.slice(0, i);
	const rest = guest.slice(i + 9);
	if (label.includes(".") || !rest.includes(".")) return false;
	return parent === rest || parent === `grok.${rest}`;
}
function resolveParentEmbedderOrigin(parentIsSelf, referrer, ancestorOrigin, guestHostname = "") {
	if (parentIsSelf) return null;
	for (const candidate of [referrer, ancestorOrigin ?? ""].filter(Boolean)) try {
		const url = new URL(candidate.includes("://") ? candidate : `https://${candidate}`);
		if (url.protocol !== "https:" && url.protocol !== "http:") continue;
		if (isGrokEmbedderOrigin(url.origin)) return url.origin;
		if (isSandboxPreviewGuestHost(guestHostname) || isRemintPreviewPair(guestHostname, url.hostname)) return url.origin;
	} catch {}
	return null;
}
/**
* Guest side of the grok-web ↔ sandbox preview postMessage bridge.
*
* Activates only when this page is framed by an allowlisted Grok embedder.
* Top-level runs (download/export, local `npm run dev`, deployed sites) noop.
*/
var PREVIEW_BRIDGE_CHANNEL = "grok-preview-bridge";
var EnvelopeSchema = object({
	channel: literal(PREVIEW_BRIDGE_CHANNEL),
	version: number().int().positive(),
	type: string().min(1)
});
var HelloSchema = EnvelopeSchema.extend({ type: literal("hello") });
var NavigateSchema = EnvelopeSchema.extend({
	type: literal("navigate"),
	path: string().min(1)
});
var HistorySchema = EnvelopeSchema.extend({
	type: literal("history"),
	delta: union([literal(-1), literal(1)])
});
var ConnectorTokenReadySchema = EnvelopeSchema.extend({ type: literal("connector-token-ready") });
function isSafeBridgePath(path) {
	if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return false;
	try {
		return new URL(path, "https://preview.invalid").origin === "https://preview.invalid";
	} catch {
		return false;
	}
}
/**
* Origin of the Grok embedder framing this page, or null when the page runs
* top-level (download/export, local `npm run dev`, deployed sites) or under a
* non-Grok parent. Client-only; null during SSR.
*/
function resolveCurrentEmbedderOrigin() {
	if (typeof window === "undefined") return null;
	const ancestorOrigin = typeof location.ancestorOrigins !== "undefined" && location.ancestorOrigins.length > 0 ? location.ancestorOrigins[0] : null;
	return resolveParentEmbedderOrigin(window.parent === window, document.referrer, ancestorOrigin, window.location.hostname);
}
/**
* Install host↔guest messaging. Returns a dispose function.
* Noops (returns a no-op dispose) when not embedded under a Grok parent.
*/
function installPreviewHostBridge(options = {}) {
	const parentOrigin = resolveCurrentEmbedderOrigin();
	if (parentOrigin === null) return () => {};
	const ROOT_STATE_KEY = "__grokPreviewBridgeRoot";
	const originalPushState = window.history.pushState.bind(window.history);
	const originalReplaceState = window.history.replaceState.bind(window.history);
	const isAtHistoryRoot = () => {
		const state = window.history.state;
		return Boolean(state && typeof state === "object" && state[ROOT_STATE_KEY] === true);
	};
	try {
		const current = window.history.state;
		if (!(current !== null && typeof current === "object" && Object.prototype.hasOwnProperty.call(current, ROOT_STATE_KEY))) {
			const isRoot = window.history.length <= 1;
			originalReplaceState(current && typeof current === "object" ? {
				...current,
				[ROOT_STATE_KEY]: isRoot
			} : { [ROOT_STATE_KEY]: isRoot }, "", window.location.href);
		}
	} catch {}
	const post = (message) => {
		window.parent.postMessage(message, parentOrigin);
	};
	const reportLocation = () => {
		post({
			channel: PREVIEW_BRIDGE_CHANNEL,
			version: 1,
			type: "location",
			path: window.location.pathname || "/",
			search: window.location.search,
			hash: window.location.hash
		});
	};
	const reportRoutes = () => {
		const paths = options.getRoutePaths?.() ?? [];
		post({
			channel: PREVIEW_BRIDGE_CHANNEL,
			version: 1,
			type: "routes",
			paths
		});
	};
	const defaultNavigate = (path) => {
		if (!isSafeBridgePath(path)) return;
		try {
			const url = new URL(path, window.location.origin);
			if (url.origin !== window.location.origin) return;
			const next = `${url.pathname}${url.search}${url.hash}`;
			window.history.pushState(window.history.state, "", next);
			window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
		} catch {}
	};
	const navigate = (path) => {
		if (!isSafeBridgePath(path)) return;
		if (options.navigate) {
			options.navigate(path);
			return;
		}
		defaultNavigate(path);
	};
	const announce = () => {
		reportLocation();
		reportRoutes();
		post({
			channel: PREVIEW_BRIDGE_CHANNEL,
			version: 1,
			type: "ready"
		});
	};
	const onHello = (data) => {
		if (!HelloSchema.safeParse(data).success) return;
		announce();
	};
	const onNavigate = (data) => {
		const parsed = NavigateSchema.safeParse(data);
		if (!parsed.success) return;
		navigate(parsed.data.path);
		queueMicrotask(reportLocation);
	};
	const onHistory = (data) => {
		const parsed = HistorySchema.safeParse(data);
		if (!parsed.success) return;
		if (parsed.data.delta === -1 && isAtHistoryRoot()) return;
		window.history.go(parsed.data.delta);
	};
	const onConnectorTokenReady = (data) => {
		if (!ConnectorTokenReadySchema.safeParse(data).success) return;
		window.dispatchEvent(new Event(CONNECTOR_TOKEN_READY_EVENT));
	};
	const hostMessageHandlers = /* @__PURE__ */ new Map([
		["hello", onHello],
		["navigate", onNavigate],
		["history", onHistory],
		["connector-token-ready", onConnectorTokenReady]
	]);
	const onMessage = (event) => {
		if (event.source !== window.parent) return;
		if (event.origin !== parentOrigin) return;
		const envelope = EnvelopeSchema.safeParse(event.data);
		if (!envelope.success || envelope.data.version !== 1) return;
		hostMessageHandlers.get(envelope.data.type)?.(event.data);
	};
	const onPopState = () => {
		reportLocation();
	};
	const onHashChange = () => {
		reportLocation();
	};
	window.history.pushState = (data, unused, url) => {
		const next = data && typeof data === "object" ? {
			...data,
			[ROOT_STATE_KEY]: false
		} : data;
		originalPushState(next, unused, url);
		reportLocation();
	};
	window.history.replaceState = (data, unused, url) => {
		const next = isAtHistoryRoot() ? {
			...data && typeof data === "object" ? data : {},
			[ROOT_STATE_KEY]: true
		} : data;
		originalReplaceState(next, unused, url);
		reportLocation();
	};
	window.addEventListener("message", onMessage);
	window.addEventListener("popstate", onPopState);
	window.addEventListener("hashchange", onHashChange);
	announce();
	return () => {
		window.removeEventListener("message", onMessage);
		window.removeEventListener("popstate", onPopState);
		window.removeEventListener("hashchange", onHashChange);
		window.history.pushState = originalPushState;
		window.history.replaceState = originalReplaceState;
	};
}
/** Collect static path patterns from a TanStack route tree (best-effort). */
function collectRoutePathsFromTree(routeTree) {
	const paths = /* @__PURE__ */ new Set();
	const walk = (node) => {
		if (!node || typeof node !== "object") return;
		const record = node;
		const full = typeof record.fullPath === "string" ? record.fullPath : typeof record.path === "string" ? record.path : null;
		if (full !== null && full !== "") paths.add(full.startsWith("/") ? full : `/${full}`);
		else if (full === "") paths.add("/");
		const children = record.children;
		if (Array.isArray(children)) for (const child of children) walk(child);
		else if (children && typeof children === "object") for (const child of Object.values(children)) walk(child);
	};
	walk(routeTree);
	return [...paths];
}
/**
* Mount once in `__root.tsx` so the Grok preview chrome can drive navigation
* (and later receive registered routes). Noops when the app is not embedded.
*/
function PreviewHostBridge() {
	const router = useRouter();
	(0, import_react.useEffect)(() => {
		return installPreviewHostBridge({
			navigate: (path) => {
				router.history.push(path);
			},
			getRoutePaths: () => collectRoutePathsFromTree(router.routeTree)
		});
	}, [router]);
	return null;
}
var KEY = "apex-quant-x-book-v1";
var Ctx = (0, import_react.createContext)(null);
function ApexProvider({ children }) {
	const [book, setBook] = (0, import_react.useState)(initialBook());
	const [busy, setBusy] = (0, import_react.useState)(false);
	const [desk, setDesk] = (0, import_react.useState)(null);
	const [checks, setChecks] = (0, import_react.useState)(null);
	const submitCall = useServerFn(submitOrderFn);
	const modeCall = useServerFn(setModeFn);
	const killCall = useServerFn(killFn);
	const scenarioCall = useServerFn(scenarioFn);
	const deskCall = useServerFn(deskFn);
	const checkCall = useServerFn(acceptanceFn);
	(0, import_react.useEffect)(() => {
		try {
			const raw = localStorage.getItem(KEY);
			if (raw) setBook(JSON.parse(raw));
		} catch {}
	}, []);
	(0, import_react.useEffect)(() => {
		localStorage.setItem(KEY, JSON.stringify(book));
	}, [book]);
	async function wrap(work) {
		setBusy(true);
		try {
			await work();
		} catch (error) {
			const message = error instanceof Error ? error.message : "The risk service rejected the request.";
			setBook((current) => ({
				...current,
				lastMessage: message
			}));
		} finally {
			setBusy(false);
		}
	}
	const api = (0, import_react.useMemo)(() => ({
		book,
		busy,
		desk,
		checks,
		submit: (intent) => wrap(async () => {
			const result = await submitCall({ data: {
				book,
				intent
			} });
			setBook(result.book);
		}),
		research: () => wrap(async () => {
			const result = await modeCall({ data: {
				book,
				mode: "RESEARCH"
			} });
			setBook(result.book);
		}),
		paper: () => wrap(async () => {
			const result = await modeCall({ data: {
				book,
				mode: "PAPER"
			} });
			setBook(result.book);
		}),
		kill: (action) => wrap(async () => {
			const result = await killCall({ data: {
				book,
				action
			} });
			setBook(result.book);
		}),
		scenario: (name) => wrap(async () => {
			setBook(await scenarioCall({ data: name }));
		}),
		review: (caseId) => wrap(async () => {
			setDesk(await deskCall({ data: {
				book,
				caseId
			} }));
		}),
		runChecks: () => wrap(async () => {
			const report = await checkCall({ data: { confirm: true } });
			setChecks(report.checks);
		})
	}), [
		book,
		busy,
		desk,
		checks,
		submitCall,
		modeCall,
		killCall,
		scenarioCall,
		deskCall,
		checkCall
	]);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Ctx.Provider, {
		value: api,
		children
	});
}
function useApex() {
	const ctx = (0, import_react.useContext)(Ctx);
	if (!ctx) throw new Error("Session missing");
	return ctx;
}
var NAV = [
	{
		to: "/",
		label: "Overview"
	},
	{
		to: "/markets",
		label: "Markets"
	},
	{
		to: "/research",
		label: "Research"
	},
	{
		to: "/lab",
		label: "Strategy lab"
	},
	{
		to: "/portfolio",
		label: "Portfolio"
	},
	{
		to: "/terminal",
		label: "Terminal"
	},
	{
		to: "/risk",
		label: "Risk"
	},
	{
		to: "/agents",
		label: "Agents"
	},
	{
		to: "/ops",
		label: "Operations"
	},
	{
		to: "/integrations",
		label: "Integrations"
	}
];
function AppShell({ children }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ApexProvider, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Frame, { children }) });
}
function Frame({ children }) {
	const path = useRouterState({ select: (s) => s.location.pathname });
	const { book, busy, paper, research, kill } = useApex();
	const equity = equityCents(book);
	const pnl = dailyPnlCents(book);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "min-h-screen bg-bg text-fg",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", {
			className: "border-b border-line bg-surface",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "flex flex-wrap items-center gap-3 px-4 py-3",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "flex items-center gap-3",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "grid h-9 w-9 place-items-center border border-brass font-mono text-xs text-brass",
						children: "AX"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-sm font-medium tracking-wide",
						children: "APEX QUANT X"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-xs text-muted",
						children: "Research organization · simulated capital"
					})] })]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "ml-auto flex flex-wrap items-center gap-2",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "border border-brass px-2 py-1 font-mono text-xs text-brass",
							children: book.mode
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "border border-line px-2 py-1 font-mono text-xs text-muted",
							children: "FIXTURE DATA"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "border border-line px-2 py-1 font-mono text-xs text-muted",
							children: book.kill.brokerConnected ? "PAPER SIMULATOR" : "BROKER OFF"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "font-mono text-sm tabular-nums",
							children: fmtCents(equity)
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: `font-mono text-sm tabular-nums ${pnl < 0 ? "text-loss" : pnl > 0 ? "text-gain" : "text-muted"}`,
							children: fmtCents(pnl)
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
							className: "font-mono text-xs text-muted",
							children: ["DD ", fmtPct(drawdown(book))]
						})
					]
				})]
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "flex max-w-full gap-2 overflow-x-auto border-t border-line px-2 py-2 md:hidden",
				children: NAV.map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(NavLink, {
					to: item.to,
					active: path === item.to,
					children: item.label
				}, item.to))
			})]
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "md:grid md:grid-cols-[13rem_1fr]",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("nav", {
				className: "hidden border-r border-line md:block",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
					className: "sticky top-0 flex flex-col gap-1 p-3",
					children: NAV.map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(NavLink, {
						to: item.to,
						active: path === item.to,
						children: item.label
					}) }, item.to))
				})
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "min-w-0",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "flex flex-wrap items-center gap-2 border-b border-line px-4 py-3",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							type: "button",
							className: "border border-line px-3 py-2 text-sm",
							disabled: busy,
							onClick: () => void research(),
							children: "Research"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							type: "button",
							className: "bg-brass px-3 py-2 text-sm text-brass-ink",
							disabled: busy,
							onClick: () => void paper(),
							children: "Enable paper"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							type: "button",
							className: "border border-loss px-3 py-2 text-sm text-loss",
							disabled: busy,
							onClick: () => void kill("block"),
							children: "Block new risk"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "basis-full text-sm text-muted",
							children: busy ? "Risk service is working." : book.lastMessage
						})
					]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("main", {
					className: "space-y-4 px-4 py-4 md:px-6 md:py-6",
					children
				})]
			})]
		})]
	});
}
function NavLink({ to, active, children }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
		to,
		className: `block whitespace-nowrap px-3 py-2 text-sm ${active ? "bg-brass text-brass-ink" : "text-muted"}`,
		children
	});
}
var SHELL_CSS = "/apex-shell.css?v=3";
var Route$10 = createRootRoute({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1"
			},
			{ title: "APEX QUANT X" },
			{
				name: "description",
				content: "Research desk, paper simulator, and risk engine. No live trading."
			},
			{
				name: "theme-color",
				content: "#101418"
			}
		],
		links: [
			{
				rel: "icon",
				type: "image/svg+xml",
				href: "/favicon.svg"
			},
			{
				rel: "stylesheet",
				href: SHELL_CSS
			},
			{
				rel: "manifest",
				href: "/__grok/manifest.webmanifest"
			},
			{
				rel: "apple-touch-icon",
				href: "/__grok/icon-180.png"
			},
			{
				rel: "stylesheet",
				href: "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap"
			}
		]
	}),
	component: () => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("html", {
		lang: "en",
		className: "antialiased",
		suppressHydrationWarning: true,
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("head", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(HeadContent, {}) }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("body", {
			className: "bg-bg text-fg",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)(PreviewHostBridge, {}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)(AuthProvider, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(AppShell, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Outlet, {}) }) }),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Scripts, {})
			]
		})]
	})
});
var $$splitComponentImporter$9 = () => import("./routes-BdTERULv.mjs");
var Route$9 = createFileRoute("/")({ component: lazyRouteComponent($$splitComponentImporter$9, "component") });
var $$splitComponentImporter$8 = () => import("./agents-DbkPUU9_.mjs");
var Route$8 = createFileRoute("/agents")({ component: lazyRouteComponent($$splitComponentImporter$8, "component") });
var $$splitComponentImporter$7 = () => import("./integrations-CeFx0Q99.mjs");
var Route$7 = createFileRoute("/integrations")({ component: lazyRouteComponent($$splitComponentImporter$7, "component") });
var $$splitComponentImporter$6 = () => import("./lab-Dpxa_-Tv.mjs");
var Route$6 = createFileRoute("/lab")({ component: lazyRouteComponent($$splitComponentImporter$6, "component") });
var $$splitComponentImporter$5 = () => import("./markets-icd0ovPE.mjs");
var Route$5 = createFileRoute("/markets")({ component: lazyRouteComponent($$splitComponentImporter$5, "component") });
var $$splitComponentImporter$4 = () => import("./ops-DkBmk01u.mjs");
var Route$4 = createFileRoute("/ops")({ component: lazyRouteComponent($$splitComponentImporter$4, "component") });
var $$splitComponentImporter$3 = () => import("./portfolio-BnUSbCHK.mjs");
var Route$3 = createFileRoute("/portfolio")({ component: lazyRouteComponent($$splitComponentImporter$3, "component") });
var $$splitComponentImporter$2 = () => import("./research-1prPnJM8.mjs");
var Route$2 = createFileRoute("/research")({ component: lazyRouteComponent($$splitComponentImporter$2, "component") });
var $$splitComponentImporter$1 = () => import("./risk-bUDNEaeI.mjs");
var Route$1 = createFileRoute("/risk")({ component: lazyRouteComponent($$splitComponentImporter$1, "component") });
var $$splitComponentImporter = () => import("./terminal-DIIIr6eS.mjs");
var Route = createFileRoute("/terminal")({ component: lazyRouteComponent($$splitComponentImporter, "component") });
var rootRouteChildren = {
	IndexRoute: Route$9.update({
		id: "/",
		path: "/",
		getParentRoute: () => Route$10
	}),
	AgentsRoute: Route$8.update({
		id: "/agents",
		path: "/agents",
		getParentRoute: () => Route$10
	}),
	IntegrationsRoute: Route$7.update({
		id: "/integrations",
		path: "/integrations",
		getParentRoute: () => Route$10
	}),
	LabRoute: Route$6.update({
		id: "/lab",
		path: "/lab",
		getParentRoute: () => Route$10
	}),
	MarketsRoute: Route$5.update({
		id: "/markets",
		path: "/markets",
		getParentRoute: () => Route$10
	}),
	OpsRoute: Route$4.update({
		id: "/ops",
		path: "/ops",
		getParentRoute: () => Route$10
	}),
	PortfolioRoute: Route$3.update({
		id: "/portfolio",
		path: "/portfolio",
		getParentRoute: () => Route$10
	}),
	ResearchRoute: Route$2.update({
		id: "/research",
		path: "/research",
		getParentRoute: () => Route$10
	}),
	RiskRoute: Route$1.update({
		id: "/risk",
		path: "/risk",
		getParentRoute: () => Route$10
	}),
	TerminalRoute: Route.update({
		id: "/terminal",
		path: "/terminal",
		getParentRoute: () => Route$10
	})
};
var routeTree = Route$10._addFileChildren(rootRouteChildren)._addFileTypes();
var router_exports = /* @__PURE__ */ __exportAll({ getRouter: () => getRouter });
function getRouter() {
	return createRouter({
		routeTree,
		rewrite: previewPathRewrite(),
		defaultErrorComponent: AppErrorComponent,
		scrollRestoration: true
	});
}
//#endregion
export { labResultsFn as a, researchContributionFn as c, integrationsFn as i, useServerFn as l, useApex as n, paperActionFn as o, dryRunFn as r, paperDeskFn as s, router_exports as t, workflowFn as u };
