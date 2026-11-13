import { i as __toESM } from "../_runtime.mjs";
import { _ as fmtPct, g as fmtNum, m as fmtCents, o as STRATEGIES } from "./rolldown-runtime-D7D4PA-g.mjs";
import { t as CONTROL } from "./backtest-DzOGIrgT.mjs";
import { l as promote } from "./trading-D0fHfFa0.mjs";
import { J as require_react, Y as require_jsx_runtime } from "../_libs/@tanstack/react-router+[...].mjs";
import { i as Pill, r as Panel, t as Banner } from "./ui-DoDCKVnC.mjs";
import { t as SPRINT3 } from "./sprint3-pGrmd1_H.mjs";
import { a as labResultsFn, c as researchContributionFn, l as useServerFn } from "./router-BUAwk0jc.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/lab-Dpxa_-Tv.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
/** Operator-facing status. Detail and checksums live in the manifest. */
var HISTORY_STATUS = {
	provider: "yahoo-chart-v8",
	fetchedUtc: "2026-11-12T04:05:31Z",
	manifest: "research/data/manifests/yahoo-20261112.json",
	secondSource: "BLOCKED",
	adjustedCloseIsPointInTime: false,
	symbols: [
		"SPY",
		"QQQ",
		"IWM",
		"GLD",
		"TLT",
		"BIL"
	]
};
function Lab() {
	const [id, setId] = (0, import_react.useState)("orb-cost-control");
	const selected = STRATEGIES.find((s) => s.id === id) ?? STRATEGIES[0];
	const gate = promote(selected.id, "VALIDATED");
	const loadScan = useServerFn(researchContributionFn);
	const loadLab = useServerFn(labResultsFn);
	const [scan, setScan] = (0, import_react.useState)(null);
	const [lab, setLab] = (0, import_react.useState)(null);
	(0, import_react.useEffect)(() => {
		loadScan().then(setScan).catch(() => setScan(null));
		loadLab().then(setLab).catch(() => setLab(null));
	}, []);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "space-y-4",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Banner, {
				tone: "loss",
				children: "Sprint 1 was stopped before validation: not live-feasible on free data, negative in development and replication. Sprint 2: S1 lost to costs, S2 faded after publication. Those figures were not in the recoverable bundle and are not rebuilt here. Sprint 3 is still an idea. The table below is coverage, not a return. T1 and T2 were not rescored."
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Panel, {
				title: "Engine results",
				kicker: "Consumed by Strategy Lab",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "text-sm text-muted",
					children: "These are research runs on real public data. They are not validated and not paper-auto eligible. The opening-range cost loss is unchanged."
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "mt-3 grid gap-3 md:grid-cols-2",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", {
						className: "border border-line p-3 text-sm",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "font-mono text-xs text-brass",
							children: "Backtrader · SPY · SMA 20/50"
						}), lab?.backtrader ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
							className: "mt-2 text-muted",
							children: [
								lab.backtrader.coverage?.first,
								" to ",
								lab.backtrader.coverage?.last,
								". Trades ",
								lab.backtrader.metrics?.tradeCount,
								". Closed PnL ",
								lab.backtrader.metrics?.closedTradePnl,
								". Equity change ",
								lab.backtrader.metrics?.equityChange,
								". Buy-and-hold return ",
								lab.backtrader.metrics?.buyAndHoldReturn,
								". Not validated."
							]
						}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "mt-2 text-muted",
							children: "No Backtrader equity run yet."
						})]
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", {
						className: "border border-line p-3 text-sm",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "font-mono text-xs text-brass",
							children: "Freqtrade env · BTC-USD · SMA 10/30"
						}), lab?.freqtrade ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
							className: "mt-2 text-muted",
							children: [
								"Trades ",
								lab.freqtrade.metrics?.tradeCount,
								". Net ",
								lab.freqtrade.metrics?.netPnl,
								". Return ",
								lab.freqtrade.metrics?.netReturn,
								". Native trading disabled. Not validated."
							]
						}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "mt-2 text-muted",
							children: "No Freqtrade crypto run yet."
						})]
					})]
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Panel, {
				title: "Day-trader plan",
				kicker: "Not a strategy promotion",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "text-sm text-muted",
					children: scan?.note ?? "No offline plan loaded."
				}), scan ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
					className: "mt-2 text-sm",
					children: [
						"Verdict ",
						scan.riskVerdict ?? "none",
						". Entry ",
						scan.plan?.entry ?? "n/a",
						", stop ",
						scan.plan?.stop ?? "n/a",
						", target ",
						scan.plan?.target ?? "n/a",
						". This does not change a registry state and cannot arm paper-auto."
					]
				}) : null]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "grid gap-4 xl:grid-cols-[1fr_20rem]",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "overflow-x-auto border border-line",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("table", {
						className: "w-full min-w-[36rem] text-left text-sm",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("thead", {
							className: "bg-surface text-xs text-muted",
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
									className: "px-3 py-2 font-medium",
									children: "Strategy"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
									className: "px-3 py-2 font-medium",
									children: "State"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
									className: "px-3 py-2 font-medium",
									children: "Evidence"
								})
							] })
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("tbody", { children: STRATEGIES.map((s) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", {
							className: "cursor-pointer border-t border-line",
							onClick: () => setId(s.id),
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("td", {
									className: "px-3 py-3",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { children: s.name }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
										className: "text-xs text-muted",
										children: s.markets
									})]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
									className: "px-3 py-3 font-mono text-xs",
									children: s.state
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
									className: "px-3 py-3 text-muted",
									children: s.evidence
								})
							]
						}, s.id)) })]
					})
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StrategyCard, {
					strategy: selected,
					blocked: gate.reasons[0] ?? "Blocked"
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(DataCheck, {}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Panel, {
				title: "Opening-range cost control",
				kicker: CONTROL.base.dataset,
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
						className: "mb-3 text-sm text-muted",
						children: [
							CONTROL.base.label,
							" ",
							CONTROL.base.notes[0]
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "overflow-x-auto",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("table", {
							className: "w-full min-w-[32rem] text-left text-sm",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("thead", {
								className: "text-xs text-muted",
								children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
										className: "py-2 font-medium",
										children: "Cost / side"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
										className: "py-2 font-medium",
										children: "Net return"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
										className: "py-2 font-medium",
										children: "Ending equity"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
										className: "py-2 font-medium",
										children: "Trades"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
										className: "py-2 font-medium",
										children: "Profit factor"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
										className: "py-2 font-medium",
										children: "Max DD"
									})
								] })
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("tbody", { children: [
								CONTROL.zero,
								CONTROL.base,
								CONTROL.stress
							].map((run) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", {
								className: "border-t border-line font-mono tabular-nums",
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("td", {
										className: "py-2",
										children: [run.costBpsPerSide, " bps"]
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
										className: run.metrics.netReturn < 0 ? "text-loss" : "text-gain",
										children: fmtPct(run.metrics.netReturn)
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: fmtCents(run.endingCents) }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: run.metrics.trades }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: Number.isFinite(run.metrics.profitFactor) ? fmtNum(run.metrics.profitFactor) : "no losses" }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: fmtPct(run.metrics.maxDrawdown) })
								]
							}, run.id)) })]
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
						className: "mt-3 space-y-1 text-sm text-muted",
						children: CONTROL.base.folds.map((fold) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { children: [
							fold.name,
							": ",
							fmtPct(fold.netReturn),
							" over ",
							fold.trades,
							" trades. Same sign in every fold because the path does not change."
						] }, fold.name))
					})
				]
			})
		]
	});
}
function StrategyCard({ strategy, blocked }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("aside", {
		className: "border border-line bg-surface p-4 text-sm",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "flex items-center justify-between gap-2",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
					className: "text-base",
					children: strategy.name
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Pill, {
					tone: strategy.state === "RETIRED" ? "loss" : strategy.state === "PAPER" ? "brass" : "muted",
					children: strategy.state
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("dl", {
				className: "mt-3 space-y-2 text-muted",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", {
						className: "text-fg",
						children: "Hypothesis"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", { children: strategy.hypothesis })] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", {
						className: "text-fg",
						children: "Entry"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", { children: strategy.entry })] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", {
						className: "text-fg",
						children: "Exit"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", { children: strategy.exit })] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", {
						className: "text-fg",
						children: "Costs"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", { children: strategy.costModel })] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", {
						className: "text-fg",
						children: "Failure"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", { children: strategy.failureModes })] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", {
						className: "text-fg",
						children: "Retirement"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", { children: strategy.retirement })] })
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
				className: "mt-3 border-t border-line pt-3 text-loss",
				children: ["Promotion blocked. ", blocked]
			})
		]
	});
}
function DataCheck() {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Panel, {
		title: "Sprint 3 data check",
		kicker: "Unfrozen · not scored",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
				className: "mb-3 text-sm text-muted",
				children: [
					"Yahoo daily bars as of ",
					HISTORY_STATUS.fetchedUtc,
					". With BIL, T1 can start ",
					SPRINT3.t1CommonStartWithBil,
					". T2 can start ",
					SPRINT3.t2CommonStart,
					". Adjusted close is not a signal. A second daily price source is ",
					HISTORY_STATUS.secondSource,
					". This table is coverage, not a return."
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "overflow-x-auto",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("table", {
					className: "w-full min-w-[36rem] text-left text-sm",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("thead", {
						className: "text-xs text-muted",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
								className: "py-2 font-medium",
								children: "Symbol"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
								className: "py-2 font-medium",
								children: "Role"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
								className: "py-2 font-medium",
								children: "First bar"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
								className: "py-2 font-medium",
								children: "Daily bars"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
								className: "py-2 font-medium",
								children: "Dividends"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
								className: "py-2 font-medium",
								children: "Splits"
							})
						] })
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("tbody", { children: SPRINT3.rows.map((row) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", {
						className: "border-t border-line font-mono tabular-nums",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
								className: "py-2",
								children: row.symbol
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
								className: "py-2 font-sans text-muted",
								children: row.role
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
								className: "py-2",
								children: row.first
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
								className: "py-2",
								children: row.bars.toLocaleString("en-US")
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
								className: "py-2",
								children: row.dividends
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
								className: "py-2",
								children: row.splits
							})
						]
					}, row.symbol)) })]
				})
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
				className: "mt-3 space-y-2 text-sm text-muted",
				children: SPRINT3.blockers.map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: item }, item))
			})
		]
	});
}
var SplitComponent = Lab;
//#endregion
export { SplitComponent as component };
