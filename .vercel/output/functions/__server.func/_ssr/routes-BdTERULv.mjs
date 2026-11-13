import { i as __toESM } from "../_runtime.mjs";
import { E as unrealizedCents, _ as fmtPct, d as equityCents, f as exposures, g as fmtNum, l as dailyPnlCents, m as fmtCents, o as STRATEGIES, u as drawdown, w as realizedCents } from "./rolldown-runtime-D7D4PA-g.mjs";
import { t as CONTROL } from "./backtest-DzOGIrgT.mjs";
import { J as require_react, Y as require_jsx_runtime } from "../_libs/@tanstack/react-router+[...].mjs";
import { a as Stat, r as Panel, t as Banner } from "./ui-DoDCKVnC.mjs";
import { l as useServerFn, n as useApex, o as paperActionFn, r as dryRunFn, s as paperDeskFn } from "./router-BUAwk0jc.mjs";
import { a as Tooltip, i as ResponsiveContainer, n as YAxis, r as Line, t as LineChart } from "../_libs/recharts+[...].mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/routes-BdTERULv.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
var DRAFT_KEY = "apex-paper-key-draft";
function readDraft() {
	if (typeof window === "undefined") return {
		keyId: "",
		secret: ""
	};
	try {
		const parsed = JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? "");
		return {
			keyId: typeof parsed.keyId === "string" ? parsed.keyId : "",
			secret: typeof parsed.secret === "string" ? parsed.secret : ""
		};
	} catch {
		return {
			keyId: "",
			secret: ""
		};
	}
}
function PaperPanel() {
	const load = useServerFn(paperDeskFn);
	const act = useServerFn(paperActionFn);
	const [desk, setDesk] = (0, import_react.useState)(null);
	const [phrase, setPhrase] = (0, import_react.useState)("");
	const [symbol, setSymbol] = (0, import_react.useState)("SPY");
	const [keyId, setKeyId] = (0, import_react.useState)("");
	const [secret, setSecret] = (0, import_react.useState)("");
	const [checking, setChecking] = (0, import_react.useState)(true);
	const [draftReady, setDraftReady] = (0, import_react.useState)(false);
	const [error, setError] = (0, import_react.useState)("");
	(0, import_react.useEffect)(() => {
		const draft = readDraft();
		setKeyId((current) => current || draft.keyId);
		setSecret((current) => current || draft.secret);
		setDraftReady(true);
		refresh();
	}, []);
	(0, import_react.useEffect)(() => {
		if (!draftReady) return;
		sessionStorage.setItem(DRAFT_KEY, JSON.stringify({
			keyId,
			secret
		}));
	}, [
		draftReady,
		keyId,
		secret
	]);
	async function refresh() {
		setError("");
		try {
			setDesk(await load({ data: { refresh: true } }));
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "The paper desk did not answer.");
		} finally {
			setChecking(false);
		}
	}
	async function pasteInto(which) {
		setError("");
		try {
			const text = (await navigator.clipboard.readText()).replace(/\s+/g, "");
			if (!text) {
				setError("The clipboard was empty. Use the manual steps under the boxes.");
				return;
			}
			if (which === "id") setKeyId(text);
			else setSecret(text);
		} catch {
			setError("Clipboard reading is blocked. Use the manual steps under the boxes.");
		}
	}
	async function run(action, extra = {}) {
		setError("");
		try {
			setDesk(await act({ data: {
				action,
				...extra
			} }));
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "The paper action was refused.");
		}
	}
	async function saveKeys() {
		setError("");
		const id = keyId.replace(/\s+/g, "");
		const sec = secret.replace(/\s+/g, "");
		if (!id || !sec) {
			setError(id ? "The secret box is still empty." : sec ? "The key ID box is still empty." : "Both boxes are still empty.");
			return;
		}
		try {
			const next = await act({ data: {
				action: "store-keys",
				keyId: id,
				secret: sec
			} });
			setDesk(next);
			if (next.keysStored) {
				setKeyId("");
				setSecret("");
				sessionStorage.removeItem(DRAFT_KEY);
			}
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "The paper key was refused. Both values are still in the boxes.");
		}
	}
	const connected = desk?.connected === true;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "space-y-4",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Banner, { children: "Alpaca paper only. Live trading is not implemented. Nothing is sent to Alpaca until both keys are saved. An empty panel is not a placeholder account." }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Panel, {
				title: "Paper keys",
				kicker: desk?.keysStored ? "Stored on the server" : checking ? "Checking" : "Not sent yet",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-sm text-muted",
						children: desk?.keysStored ? "The saved paper key is still on the server. These boxes are only for replacing it. A reload checks Alpaca again and does not erase the saved key." : "Monitoring stays idle until both values are saved. Typing in these boxes is not cleared by a desk refresh."
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
						className: "mt-3 grid gap-2 sm:grid-cols-2",
						onSubmit: (event) => {
							event.preventDefault();
							saveKeys();
						},
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
								className: "block text-xs text-muted",
								children: ["Paper key ID", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("textarea", {
									className: "mt-1 h-20 w-full resize-y border border-line bg-bg px-3 py-2 font-mono text-sm text-fg",
									name: "paper-key-id",
									autoComplete: "off",
									autoCapitalize: "off",
									spellCheck: false,
									value: keyId,
									onChange: (event) => setKeyId(event.target.value)
								})]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
								className: "block text-xs text-muted",
								children: ["Paper secret", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("textarea", {
									className: "mt-1 h-20 w-full resize-y border border-line bg-bg px-3 py-2 font-mono text-sm text-fg",
									name: "paper-secret",
									autoComplete: "off",
									autoCapitalize: "off",
									spellCheck: false,
									value: secret,
									onChange: (event) => setSecret(event.target.value)
								})]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
								className: "text-xs text-muted sm:col-span-2",
								children: [
									"Key ID ",
									keyId.replace(/\s+/g, "").length,
									" characters. Secret ",
									secret.replace(/\s+/g, "").length,
									" characters. Spaces and line breaks are ignored. Both counts must be greater than zero before Save."
								]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "flex flex-wrap gap-2 sm:col-span-2",
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
										type: "button",
										className: "border border-line px-3 py-2 text-sm",
										onClick: () => void pasteInto("id"),
										children: "Paste key ID"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
										type: "button",
										className: "border border-line px-3 py-2 text-sm",
										onClick: () => void pasteInto("secret"),
										children: "Paste secret"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
										type: "submit",
										className: "bg-brass px-3 py-2 text-sm text-brass-ink",
										children: "Save paper keys"
									})
								]
							})
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("ol", {
						className: "mt-3 list-decimal space-y-1 pl-4 text-sm text-muted",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: "Copy the paper key ID. Click inside the Paper key ID box. Right-click and choose Paste, or press Ctrl+V or Cmd+V. You can also type it." }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: "Copy the paper secret. Click inside the Paper secret box. Paste or type it the same way. The first box must still show the key ID." }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: "Check the two character counts. If either is zero, that value was not entered." }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: "Press Save paper keys. The boxes clear only after the server confirms both were stored." })
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-2 text-xs text-muted",
						children: checking && !desk ? "Checking the saved paper key." : desk?.keysStored ? "A paper key is already stored. The secret is not shown again." : "No paper key is stored yet."
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "grid gap-3 sm:grid-cols-2 xl:grid-cols-4",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Stat, {
						label: "Launch mode",
						value: desk?.launchMode ?? (checking ? "CHECKING" : "IDLE"),
						hint: desk ? "Saved keys only" : checking ? "Asking the paper host" : "No broker call yet"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Stat, {
						label: "Paper account",
						value: connected ? "Authenticated" : checking ? "Checking" : "Not connected",
						tone: connected ? "gain" : "warn",
						hint: desk?.host ?? "Waiting for a saved paper key"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Stat, {
						label: "Broker equity",
						value: desk?.account ? `$${desk.account.equity}` : "—",
						hint: "Reported by Alpaca, or blank"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Stat, {
						label: "Cash",
						value: desk?.account ? `$${desk.account.cash}` : "—",
						hint: desk?.account ? `Buying power $${desk.account.buyingPower}` : "No broker cash figure"
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Panel, {
				title: "Session",
				kicker: desk?.clock?.isOpen ? "Market open" : "Clock",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-sm text-muted",
						children: desk?.reason ?? (checking ? "Checking the saved paper key." : "Idle. No broker call until both keys are saved.")
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("dl", {
						className: "mt-3 grid gap-3 text-sm sm:grid-cols-2",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Item, {
								label: "Clock",
								value: desk?.clock ? `${desk.clock.timestamp} · ${desk.clock.isOpen ? "open" : "closed"}` : "No clock"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Item, {
								label: "Last data",
								value: desk?.lastDataTs ?? "No timestamp"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Item, {
								label: "Data",
								value: desk ? `${desk.dataFeed} · ${desk.dataNote}` : "—"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Item, {
								label: "Streams",
								value: desk?.streamNote ?? "—"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Item, {
								label: "Safety checks",
								value: desk ? desk.safetyPassed ? "Passed locally" : desk.safetyFailed.join(" ") : "—"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Item, {
								label: "Reconcile",
								value: desk?.reconciliationClean ? "Broker positions match filled qty" : desk?.reconciliationNotes.join(" ") || "Not confirmed"
							})
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "mt-4 flex flex-wrap gap-2",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								type: "button",
								className: "border border-line px-3 py-2 text-sm",
								onClick: () => void refresh(),
								children: "Refresh"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								type: "button",
								className: "border border-line px-3 py-2 text-sm",
								onClick: () => void run("propose-smoke"),
								children: "Propose 1 SPY smoke"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								type: "button",
								className: "border border-line px-3 py-2 text-sm",
								onClick: () => void run("arm-manual"),
								children: "Arm paper manual"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								type: "button",
								className: "border border-line px-3 py-2 text-sm",
								onClick: () => void run("disarm"),
								children: "Back to monitoring"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								type: "button",
								className: "border border-loss px-3 py-2 text-sm text-loss",
								onClick: () => void run("emergency"),
								children: "Emergency stop"
							})
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
						className: "mt-3 flex flex-wrap items-center gap-2",
						onSubmit: (event) => {
							event.preventDefault();
							run("approve-auto", { phrase });
						},
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
							className: "min-w-0 flex-1 border border-line bg-bg px-3 py-2 text-sm",
							value: phrase,
							placeholder: "Type APPROVE PAPER AUTO",
							onChange: (event) => setPhrase(event.target.value)
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							type: "submit",
							className: "border border-line px-3 py-2 text-sm",
							children: "Approve paper auto"
						})]
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "grid gap-4 lg:grid-cols-2",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Panel, {
					title: "Broker positions",
					kicker: "Alpaca paper",
					children: [desk && desk.positions.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-sm text-muted",
						children: "No broker positions were returned."
					}) : null, /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
						className: "space-y-2",
						children: desk?.positions.map((row) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
							className: "grid grid-cols-2 gap-2 border-b border-line pb-2 font-mono text-xs sm:grid-cols-4",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: row.symbol }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: row.qty }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: row.unrealizedPl }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: row.marketValue })
							]
						}, row.symbol))
					})]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Panel, {
					title: "Working orders",
					kicker: "Paper broker ids",
					children: [desk && desk.orders.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-sm text-muted",
						children: "No paper orders in this session."
					}) : null, /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
						className: "space-y-2",
						children: desk?.orders.map((order) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
							className: "border-b border-line pb-2 text-sm",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
									className: "font-mono text-xs",
									children: [
										order.symbol,
										" ",
										order.side,
										" ",
										order.qty,
										" · ",
										order.state
									]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "mt-1 block text-muted",
									children: order.reason
								}),
								[
									"submitted",
									"accepted",
									"partially_filled",
									"pending_cancel"
								].includes(order.state) ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
									type: "button",
									className: "mt-1 border border-line px-2 py-1 text-xs",
									onClick: () => void run("cancel", { symbol: order.clientOrderId }),
									children: "Cancel"
								}) : null
							]
						}, order.clientOrderId))
					})]
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Panel, {
				title: "Signals",
				kicker: "Experimental opening range",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mb-3 text-sm text-muted",
						children: "Fifteen-minute breakout, long only, unadjusted bars. Not a validated strategy. The old negative cost study is unchanged."
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("ul", {
						className: "space-y-2",
						children: [desk?.signals.map((signal) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
							className: "grid gap-1 border-b border-line pb-2 text-sm md:grid-cols-[5rem_8rem_1fr]",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "font-mono",
									children: signal.symbol
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: signal.action }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "text-muted",
									children: signal.reason
								})
							]
						}, signal.symbol)), desk && desk.signals.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", {
							className: "text-sm text-muted",
							children: "No signal. Market data was not authenticated, or the market is closed."
						}) : null]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
						className: "mt-4 flex flex-wrap items-center gap-2",
						onSubmit: (event) => {
							event.preventDefault();
							run("propose-entry", { symbol });
						},
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("select", {
							className: "border border-line bg-bg px-3 py-2 text-sm",
							value: symbol,
							onChange: (event) => setSymbol(event.target.value),
							children: [
								"SPY",
								"QQQ",
								"IWM",
								"GLD",
								"TLT"
							].map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: item }, item))
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							type: "submit",
							className: "border border-line px-3 py-2 text-sm",
							children: "Propose paper order"
						})]
					}),
					desk?.proposal ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "mt-3 border border-line p-3 text-sm",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
								className: "font-mono text-xs",
								children: [
									desk.proposal.symbol,
									" ",
									desk.proposal.side,
									" ",
									desk.proposal.qty,
									" · ",
									desk.proposal.clientOrderId
								]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "mt-1 text-muted",
								children: desk.proposal.eligible ? "Eligible. Operator confirmation still required." : desk.proposal.reasons.join(" ")
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
								className: "mt-1 text-xs text-muted",
								children: [
									"Notional ",
									desk.proposal.notionalCents,
									" cents. Cash ",
									desk.proposal.cashCents,
									" cents. Market ",
									desk.proposal.marketOpen ? "open" : "closed",
									"."
								]
							}),
							desk.proposal.eligible ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								type: "button",
								className: "mt-2 bg-brass px-3 py-2 text-sm text-brass-ink",
								disabled: !connected || desk.launchMode === "MONITORING",
								onClick: () => void run("confirm-entry", {
									symbol: desk.proposal?.symbol,
									operatorConfirmed: true
								}),
								children: "Confirm paper entry"
							}) : null
						]
					}) : null,
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-2 text-xs text-muted",
						children: "Nothing is sent while the market is closed, while mode is monitoring, or before operator confirmation. Live is not selectable."
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Panel, {
				title: "Events",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
						className: "space-y-2",
						children: (desk?.events ?? []).slice().reverse().map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
							className: "grid gap-1 border-b border-line pb-2 text-sm md:grid-cols-[14rem_1fr]",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
								className: "font-mono text-xs text-muted",
								children: [item.ts.slice(11, 19), " UTC"]
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: item.text })]
						}, `${item.ts}-${item.text}`))
					}),
					error ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-3 text-sm text-loss",
						children: error
					}) : null,
					desk?.riskNotes.length ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-3 text-sm text-warn",
						children: desk.riskNotes.join(" ")
					}) : null
				]
			})
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
function DryRunPanel() {
	const load = useServerFn(dryRunFn);
	const [view, setView] = (0, import_react.useState)(null);
	const [error, setError] = (0, import_react.useState)("");
	(0, import_react.useEffect)(() => {
		refresh();
	}, []);
	async function refresh() {
		try {
			setView(await load());
			setError("");
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "Dry-run reader failed.");
		}
	}
	const status = view?.status ?? "OFFLINE";
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Panel, {
		title: "Freqtrade dry-run — not Alpaca",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-sm text-muted-foreground",
				children: "Simulated Kraken position. This is not a broker-paper or live position."
			}),
			error ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-sm text-red-400",
				children: error
			}) : null,
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "grid gap-3 sm:grid-cols-2 xl:grid-cols-4",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Stat, {
						label: "Status",
						value: status,
						hint: view?.heartbeatAgeSec != null ? `Heartbeat ${view.heartbeatAgeSec}s ago` : "No heartbeat"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Stat, {
						label: "Strategy",
						value: view?.strategy ?? "—",
						hint: view?.mode ?? "DRY-RUN"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Stat, {
						label: "Pair",
						value: view?.position?.pair ?? "none",
						hint: view?.position ? `qty ${view.position.qty}` : "No open trade"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Stat, {
						label: "Entry",
						value: view?.position?.entry ?? "—",
						hint: view?.position?.openDate ?? ""
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				type: "button",
				className: "text-sm underline",
				onClick: () => void refresh(),
				children: "Refresh"
			})
		]
	});
}
function Overview() {
	const { book } = useApex();
	const eq = equityCents(book);
	const pnl = dailyPnlCents(book);
	const exp = exposures(book);
	const counts = STRATEGIES.reduce((acc, s) => {
		acc[s.state] = (acc[s.state] ?? 0) + 1;
		return acc;
	}, {});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "space-y-4",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(PaperPanel, {}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(DryRunPanel, {}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Banner, { children: "The book below is an internal fixture, not a broker. Alpaca paper is the separate panel. It stays blank until the paper host authenticates. Live trading is not implemented. Sprint 1 and 2 stay retired. Sprint 3 has not been scored. The opening-range loss is unchanged." }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "grid gap-3 sm:grid-cols-2 xl:grid-cols-4",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Stat, {
						label: "Simulated equity",
						value: fmtCents(eq),
						hint: "Cash plus fixture marks"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Stat, {
						label: "Day P&L",
						value: fmtCents(pnl),
						tone: pnl < 0 ? "loss" : pnl > 0 ? "gain" : "fg",
						hint: "Against the session open"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Stat, {
						label: "Drawdown from peak",
						value: fmtPct(drawdown(book)),
						tone: drawdown(book) >= .05 ? "warn" : "fg",
						hint: "Review at 5%. Block new risk at 8%."
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Stat, {
						label: "Gross exposure",
						value: fmtCents(exp.grossCents),
						hint: `Net ${fmtCents(exp.netCents)}`
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "grid gap-4 lg:grid-cols-2",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Panel, {
					title: "Cost control, not the book",
					kicker: "Illustrative path",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
						className: "mb-3 text-sm text-muted",
						children: [
							"Forty identical sessions. A 4 cent continuation against 8 bps a side. Net return ",
							fmtPct(CONTROL.base.metrics.netReturn),
							". Sharpe is ",
							fmtNum(CONTROL.base.metrics.sharpe),
							" because variance is zero."
						]
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "h-48 w-full",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ResponsiveContainer, {
							width: "100%",
							height: "100%",
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(LineChart, {
								data: CONTROL.base.equity,
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)(YAxis, {
										hide: true,
										domain: ["dataMin", "dataMax"]
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Tooltip, {
										formatter: (value) => fmtCents(Number(value)),
										labelFormatter: () => "Constructed session",
										contentStyle: {
											background: "var(--color-surface)",
											border: "1px solid var(--color-line)",
											color: "var(--color-fg)"
										}
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Line, {
										type: "stepAfter",
										dataKey: "equityCents",
										stroke: "var(--color-loss)",
										dot: false,
										strokeWidth: 2
									})
								]
							})
						})
					})]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "space-y-4",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Panel, {
						title: "Book",
						kicker: book.mode,
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("dl", {
							className: "grid grid-cols-2 gap-3 text-sm",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Row, {
									label: "Cash",
									value: fmtCents(book.cashCents)
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Row, {
									label: "Realized",
									value: fmtCents(realizedCents(book))
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Row, {
									label: "Unrealized",
									value: fmtCents(unrealizedCents(book))
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Row, {
									label: "Open positions",
									value: String(book.positions.filter((p) => p.qtyMicros !== 0).length)
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Row, {
									label: "Orders",
									value: String(book.orders.length)
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Row, {
									label: "Data",
									value: book.dataStatus
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Row, {
									label: "Reconcile",
									value: book.reconciliation
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Row, {
									label: "Kill",
									value: book.kill.blockNew ? "Blocking new risk" : "Open"
								})
							]
						})
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Panel, {
						title: "Registry",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
							className: "flex flex-wrap gap-2",
							children: Object.entries(counts).map(([state, n]) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
								className: "border border-line px-2 py-1 font-mono text-xs text-muted",
								children: [
									state,
									" ",
									n
								]
							}, state))
						})
					})]
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Panel, {
				title: "Audit",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
					className: "space-y-2",
					children: book.audits.slice(-6).reverse().map((event) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
						className: "grid gap-1 border-b border-line pb-2 text-sm md:grid-cols-[11rem_9rem_1fr]",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
								className: "font-mono text-xs text-muted",
								children: [event.ts.slice(11, 19), " UTC"]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: "text-brass",
								children: event.action
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: "text-muted",
								children: event.detail
							})
						]
					}, event.id))
				})
			})
		]
	});
}
function Row({ label, value }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", {
		className: "text-xs text-muted",
		children: label
	}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", {
		className: "font-mono tabular-nums",
		children: value
	})] });
}
var SplitComponent = Overview;
//#endregion
export { SplitComponent as component };
