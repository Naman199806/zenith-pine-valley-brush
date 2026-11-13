//#region node_modules/.nitro/vite/services/ssr/assets/sprint3-pGrmd1_H.js
var SPRINT3 = {
	frozen: false,
	scored: false,
	fetchedUtc: "2026-11-12T03:15:31Z",
	source: "Yahoo Finance chart API v8, daily bars, explicit period1/period2. Range=max was rejected because it returned monthly bars.",
	alpacaCompared: false,
	stooqReached: false,
	nasdaqHistoricalRows: 0,
	auctionCostBps: null,
	yahooAdjCloseIsPointInTime: false,
	t1CommonStartWithBil: "2007-05-30",
	t1BasketOnlyStart: "2006-02-06",
	t2CommonStart: "1999-03-10",
	rows: [
		{
			symbol: "SPY",
			role: "T1 basket, T2",
			first: "1993-01-29",
			last: "2026-11-11",
			bars: 8505,
			dividends: 136,
			splits: 0
		},
		{
			symbol: "QQQ",
			role: "T2",
			first: "1999-03-10",
			last: "2026-11-11",
			bars: 6963,
			dividends: 90,
			splits: 1
		},
		{
			symbol: "EFA",
			role: "T1 basket",
			first: "2001-08-27",
			last: "2026-11-11",
			bars: 6340,
			dividends: 47,
			splits: 1
		},
		{
			symbol: "EEM",
			role: "T1 basket",
			first: "2003-04-14",
			last: "2026-11-11",
			bars: 5934,
			dividends: 47,
			splits: 2
		},
		{
			symbol: "TLT",
			role: "T1 basket",
			first: "2002-07-30",
			last: "2026-11-11",
			bars: 6112,
			dividends: 290,
			splits: 0
		},
		{
			symbol: "IEF",
			role: "T1 basket",
			first: "2002-07-30",
			last: "2026-11-11",
			bars: 6112,
			dividends: 292,
			splits: 0
		},
		{
			symbol: "GLD",
			role: "T1 basket",
			first: "2004-11-18",
			last: "2026-11-11",
			bars: 5530,
			dividends: 0,
			splits: 0
		},
		{
			symbol: "DBC",
			role: "T1 basket",
			first: "2006-02-06",
			last: "2026-11-11",
			bars: 5225,
			dividends: 9,
			splits: 0
		},
		{
			symbol: "VNQ",
			role: "T1 basket",
			first: "2004-09-29",
			last: "2026-11-11",
			bars: 5566,
			dividends: 88,
			splits: 0
		},
		{
			symbol: "BIL",
			role: "T1 T-bill excess",
			first: "2007-05-30",
			last: "2026-11-11",
			bars: 4896,
			dividends: 129,
			splits: 1
		}
	],
	blockers: [
		"Alpaca was not compared. There is no credential, so the 2016–2026 tolerance check did not run.",
		"Stooq returned a browser challenge. Nasdaq historical returned zero rows. One vendor is not a cross-check.",
		"Yahoo adjusted close is rewritten when a later dividend is paid. It is not a point-in-time vintage.",
		"Daily open and close do not measure auction cost against the continuous book.",
		"QQQ begins 1999-03-10, not 1993-02. BIL begins 2007-05-30, not 2006-03. The draft windows are wrong."
	]
};
/** Cash dividends whose ex-timestamp is strictly after entry and at or before as-of. */
function cashDividendsInWindow(divs, afterTs, asOfTs) {
	let sum = 0;
	for (const div of divs) if (div.exTs > afterTs && div.exTs <= asOfTs) sum += div.amount;
	return sum;
}
/** Close-to-close change plus cash dividends already in the window. Not a backtest. */
function holdingTotalReturn(entry, exit, dividends) {
	if (!(entry > 0) || !Number.isFinite(exit) || !Number.isFinite(dividends)) throw new Error("Bad holding inputs.");
	return (exit + dividends) / entry - 1;
}
//#endregion
export { cashDividendsInWindow as n, holdingTotalReturn as r, SPRINT3 as t };
