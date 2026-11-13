import { applySplits, runIllustrativeOrb, runNoiseWalk, validateBars } from "./backtest.ts";
import { cryptoArb, expiryStatus, futuresStress, runDesk } from "./desk.ts";
import { type Book, initialBook, instrument, positionQty, quoteOf, strategy } from "./domain.ts";
import { notionalCents } from "./money.ts";
import { runPaperSafety } from "./broker/safety.ts";
import { promoteLaunch } from "./broker/launch.ts";
import { SPRINT3, cashDividendsInWindow, holdingTotalReturn } from "./sprint3.ts";
import { duplicateDates, missingSessions, badSplits, dividendsMissingEx, revisedAdjustedClose, missingSymbols, researchPayloadBlocks } from "./integrity.ts";
import {
  agentTool,
  applyAssignment,
  applySubmission,
  gapThroughStop,
  loadScenario,
  loseAcknowledgement,
  promote,
  reconcileOrder,
  rejectCancel,
  requestCancel,
  setKill,
  setMode,
  sizingPreview,
} from "./trading.ts";

export interface Check {
  id: string;
  group: string;
  passed: boolean;
  detail: string;
}

function check(group: string, id: string, passed: boolean, detail: string): Check {
  return { group, id, passed, detail };
}

function paper(): Book {
  return setMode(initialBook(), "PAPER").book;
}

function replayCash(book: Book, start: number): number {
  let cash = start;
  for (const order of book.orders) {
    for (const fill of order.fills) {
      const notion = notionalCents(fill.priceMicros, fill.qtyMicros);
      if (order.side === "buy") cash -= notion + fill.feeCents;
      else cash += notion - fill.feeCents;
    }
  }
  return cash;
}

export function runAcceptance(): { checks: Check[]; passed: number; failed: number } {
  const checks: Check[] = [];
  const zero = runIllustrativeOrb(0);
  const base = runIllustrativeOrb(8);
  const stress = runIllustrativeOrb(16);
  const corruptLater = runIllustrativeOrb(8, { fromBar: 8, delta: 500 });
  const corruptFill = runIllustrativeOrb(8, { fromBar: 7, delta: 500 });
  checks.push(
    check("backtest", "cost-drag", zero.endingCents > base.endingCents && base.endingCents > stress.endingCents, `0 bps ends ${zero.endingCents}, 8 bps ends ${base.endingCents}, 16 bps ends ${stress.endingCents}.`),
    check("backtest", "net-loss-after-cost", base.metrics.netReturn < 0 && zero.metrics.netReturn > 0, `Gross return ${zero.metrics.grossReturn}. Net return ${base.metrics.netReturn}.`),
    check("backtest", "no-lookahead", base.lookaheadSafe && base.trades[0]?.fillPriceCents === 10020 && corruptLater.trades[0]?.fillPriceCents === base.trades[0]?.fillPriceCents && corruptFill.trades[0]?.fillPriceCents !== base.trades[0]?.fillPriceCents, "Entry is the next open. Later bars do not change it."),
    check("backtest", "zero-variance-not-a-pass", !Number.isFinite(base.metrics.sharpe) && promote("orb-cost-control", "VALIDATED").ok === false, "Identical sessions make Sharpe unusable. The control stays retired."),
    check("backtest", "noise-not-evidence", runNoiseWalk(8).dataset === "SYNTHETIC_NOISE_V1" && promote("orb-cost-control", "PAPER").ok === false, "Seeded noise cannot revive a retired rule."),
    check("registry", "sprint-record", strategy("s1-intraday")?.state === "RETIRED" && strategy("s2-holdout")?.state === "RETIRED" && strategy("t1-tsmom")?.state === "IDEA" && strategy("t2-overnight")?.state === "IDEA", "Sprint 1 and 2 stay retired. Sprint 3 stays an idea."),
    check("registry", "sprint3-unscored", SPRINT3.frozen === false && SPRINT3.scored === false && SPRINT3.auctionCostBps === null && SPRINT3.alpacaCompared === false && SPRINT3.rows.find((r) => r.symbol === "BIL")?.first === "2007-05-30" && SPRINT3.t2CommonStart === "1999-03-10", "Coverage is recorded. No T1 or T2 return was computed."),
    check("registry", "no-skip", promote("t1-tsmom", "VALIDATED").ok === false && promote("paper-mechanics", "SHADOW").ok === false && promote("paper-mechanics", "LIVE").ok === false, "Gates cannot be skipped and live stays locked."),
  );

  const research = applySubmission(initialBook(), sizingPreview(initialBook(), "SPY"));
  checks.push(check("execution", "research-cannot-fill", research.ok === false && research.order?.state === "rejected" && research.order.fills.length === 0 && research.book.cashCents === 100_000_000, research.message));

  const live = setMode(initialBook(), "LIVE");
  checks.push(check("execution", "live-locked", live.ok === false && live.book.mode === "RESEARCH", live.message));

  const session = paper();
  const buy = applySubmission(session, sizingPreview(session, "SPY"));
  const again = buy.order ? applySubmission(buy.book, sizingPreview(session, "SPY")) : buy;
  // sizingPreview keys off order count, so build an explicit duplicate key
  const dupIntent = sizingPreview(session, "SPY");
  const first = applySubmission(session, { ...dupIntent, idempotencyKey: "same-key" });
  const second = applySubmission(first.book, { ...dupIntent, idempotencyKey: "same-key", qtyMicros: dupIntent.qtyMicros });
  checks.push(
    check("execution", "paper-fill-not-live", Boolean(first.ok && first.order && first.order.live === false && first.order.mode === "PAPER" && first.order.fills.length === 1 && first.order.strategyVersion === "plumbing-1" && first.order.riskDecisionId.length > 0), first.message),
    check("execution", "idempotent-key", second.order?.id === first.order?.id && second.book.orders.filter((o) => o.idempotencyKey === "same-key").length === 1 && second.book.orders[0]?.fills.length === 1, "One key, one order, one fill."),
    check("execution", "ledger-matches-fills", first.book.cashCents === replayCash(first.book, 100_000_000) && positionQty(first.book, "SPY") === first.order?.filledQtyMicros, `Cash ${first.book.cashCents}.`),
    check("execution", "rejected-not-a-fill", research.order?.fills.length === 0, "A rejected order has no fill."),
  );
  void buy;
  void again;

  const unapproved = applySubmission(session, { ...sizingPreview(session, "SPY"), strategyId: "t1-tsmom", strategyVersion: "draft-2026-11-11", idempotencyKey: "bad-strat" });
  const fakePx = applySubmission(session, { ...sizingPreview(session, "SPY"), expectedPriceMicros: 1, idempotencyKey: "fake-px" });
  const fakeId = applySubmission(session, { ...sizingPreview(session, "NOPE"), instrumentId: "NOPE", idempotencyKey: "fake-id" });
  const agentOrder = applySubmission(session, { ...sizingPreview(session, "SPY"), actor: "agent", idempotencyKey: "agent-order" });
  const tool = agentTool(session, "setRiskLimit");
  checks.push(
    check("risk", "unapproved-strategy", unapproved.ok === false && unapproved.order?.fills.length === 0, unapproved.message),
    check("risk", "hallucinated-price", fakePx.ok === false, fakePx.message),
    check("risk", "unknown-instrument", fakeId.ok === false, fakeId.message),
    check("risk", "agent-cannot-send", agentOrder.ok === false, agentOrder.message),
    check("risk", "agent-cannot-change-limits", tool.ok === false && tool.book.kill.blockNew === session.kill.blockNew && tool.book.cashCents === session.cashCents, tool.message),
  );

  const stale = applySubmission({ ...session, dataStatus: "stale" }, { ...sizingPreview(session, "SPY"), idempotencyKey: "stale" });
  const halted = applySubmission({ ...session, dataStatus: "halted" }, { ...sizingPreview(session, "SPY"), idempotencyKey: "halted" });
  const broken = applySubmission({ ...session, reconciliation: "broken" }, { ...sizingPreview(session, "SPY"), idempotencyKey: "broken" });
  const expired = applySubmission({ ...session, credentials: "expired" }, { ...sizingPreview(session, "SPY"), idempotencyKey: "expired" });
  const haltedVenue = applySubmission({ ...session, withdrawalHalt: ["SIM-CRYPTO"] }, { ...sizingPreview(session, "BTC-USD"), instrumentId: "BTC-USD", idempotencyKey: "halt-wd" });
  const loss = applySubmission(loadScenario("daily-loss"), { ...sizingPreview(loadScenario("daily-loss"), "SPY"), idempotencyKey: "loss" });
  checks.push(
    check("risk", "stale-blocks", stale.ok === false && halted.ok === false, `${stale.message} ${halted.message}`),
    check("risk", "mismatch-blocks", broken.ok === false, broken.message),
    check("risk", "expired-key-blocks", expired.ok === false, expired.message),
    check("risk", "withdrawal-halt", haltedVenue.ok === false, haltedVenue.message),
    check("risk", "daily-loss-block", loss.ok === false, loss.message),
    check("risk", "factor-reject", runDesk(session, "correlated").blocked, runDesk(session, "correlated").blockReasons.join(" ")),
  );

  const restingIntent = { ...sizingPreview(session, "SPY"), orderType: "limit" as const, limitPriceMicros: 1, idempotencyKey: "rest" };
  const resting = applySubmission(session, restingIntent);
  const lost = loseAcknowledgement(resting.book, resting.order?.id ?? "");
  const rec = reconcileOrder(lost.book, resting.order?.id ?? "", resting.order?.qtyMicros ?? 0, quoteOf("SPY")!.askMicros);
  const rec2 = reconcileOrder(rec.book, resting.order?.id ?? "", resting.order?.qtyMicros ?? 0, quoteOf("SPY")!.askMicros);
  checks.push(
    check("failure", "lost-ack-no-blind-retry", lost.order?.state === "unknown" && lost.order.fills.length === 0 && lost.order.ackLost === true, lost.message),
    check("failure", "reconcile-once", rec.order?.fills.length === 1 && rec2.order?.fills.length === 1 && rec.book.cashCents === rec2.book.cashCents, "A second reconcile does not add a fill."),
  );

  const cancel = requestCancel(resting.book, resting.order?.id ?? "");
  const denied = rejectCancel(cancel.book, resting.order?.id ?? "");
  checks.push(check("failure", "cancel-rejected", denied.order?.state === "cancel_rejected" && denied.book.kill.positionsConfirmedFlat === false, denied.message));

  const gap = gapThroughStop(session);
  const stop = gap.order?.stopPriceMicros ?? 0;
  const filled = gap.order?.fills[0]?.priceMicros ?? 0;
  checks.push(check("failure", "gap-worse-than-stop", filled < stop && gap.book.kill.positionsConfirmedFlat === false, gap.message));

  const assigned = applyAssignment(initialBook());
  const spy = assigned.book.positions.find((p) => p.instrumentId === "SPY");
  checks.push(check("failure", "assignment-is-exposure", Boolean(spy && spy.qtyMicros > 0) && assigned.book.positions.some((p) => p.strategyId === "assignment"), assigned.message));

  const open = loadScenario("open-risk");
  const killed = setKill(open, "flatten");
  checks.push(
    check("failure", "restart-keeps-position", positionQty(structuredClone(open), "SPY") > 0, "A cloned book still has the open position."),
    check("failure", "kill-does-not-mean-flat", killed.book.kill.flattenRequested && killed.book.kill.positionsConfirmedFlat === false && positionQty(killed.book, "SPY") > 0, killed.message),
  );

  const bars = validateBars([
    { ts: "2024-01-02T14:30:00.000Z", open: 100, high: 101, low: 99, close: 100, volume: 10 },
    { ts: "2024-01-02T14:30:00.000Z", open: 100, high: 101, low: 99, close: 100, volume: 10 },
    { ts: "2024-01-02T14:00:00.000Z", open: 100, high: 90, low: 110, close: 100, volume: -1 },
  ]);
  const futureSplit = applySplits([{ ts: "2024-01-01T00:00:00.000Z", open: 200, high: 200, low: 200, close: 200, volume: 1 }], [{ exTs: "2026-12-01T00:00:00.000Z", numerator: 2, denominator: 1 }], "2026-11-11T21:00:00.000Z");
  const divs = [
    { exTs: "2024-06-15T13:30:00.000Z", amount: 1 },
    { exTs: "2024-12-15T13:30:00.000Z", amount: 5 },
  ];
  const known = cashDividendsInWindow(divs, "2024-01-01T00:00:00.000Z", "2024-07-01T00:00:00.000Z");
  const leaked = cashDividendsInWindow(divs, "2024-01-01T00:00:00.000Z", "2024-12-31T00:00:00.000Z");
  checks.push(
    check("data", "quarantine", bars.ok.length === 1 && bars.quarantine.length === 2, bars.quarantine.map((q) => q.reason).join(" | ")),
    check("data", "future-split-ignored", futureSplit[0]?.close === 200, "A split after as-of does not rewrite the bar."),
    check("data", "future-dividend-ignored", known === 1 && leaked === 6 && holdingTotalReturn(4, 2, known === 1 ? 2 : -1) === 0 && holdingTotalReturn(4, 2, 0) === -0.5, "A later ex-date is not income. Omitting the cash dividend understates the holder."),
    check("data", "expiry-warning", expiryStatus().some((e) => e.id === "CLZ26" && e.warn), expiryStatus().map((e) => e.detail).join(" ")),
    check(
      "data",
      "tape-defects",
      duplicateDates([
        { date: "2024-01-02", open: 1, high: 1, low: 1, close: 1, volume: 1 },
        { date: "2024-01-02", open: 1, high: 1, low: 1, close: 1, volume: 1 },
      ]).length === 1 &&
        missingSessions(["2024-01-02", "2024-01-03"], ["2024-01-02"]).join() === "2024-01-03" &&
        badSplits([{ exDate: null, numerator: 2, denominator: 0 }]).length === 2 &&
        dividendsMissingEx([{ exDate: null, amount: 1 }]) === 1 &&
        revisedAdjustedClose([{ date: "2024-01-02", adj: 10 }], [{ date: "2024-01-02", adj: 9 }]).join() === "2024-01-02" &&
        missingSymbols(["SPY", "IWM"], ["SPY"]).join() === "IWM",
      "Duplicate bars, a missing session, a bad split, a dividend without an ex-date, a revised adjusted close, and a missing symbol are all flagged.",
    ),
  );

  const poisoned = researchPayloadBlocks({
    strategyId: "t1-tsmom",
    scored: true,
    frozen: false,
    dividendsHaveExTimestamp: false,
    adjustedCloseUsedAsPrice: true,
    historyComplete: false,
    corporateActionsConsistent: false,
    calendarsAligned: false,
  });
  checks.push(
    check(
      "risk",
      "research-cannot-become-an-order",
      poisoned.length >= 6 && !poisoned.some((r) => r.includes("plumbing")) && strategy("t1-tsmom")?.state === "IDEA" && strategy("t2-overnight")?.state === "IDEA" && setMode(initialBook(), "LIVE").book.mode === "RESEARCH",
      poisoned.join(" "),
    ),
  );

  const deskConflict = runDesk(session, "conflict");
  const arb = cryptoArb();
  const fut = futuresStress();
  checks.push(
    check("desk", "conflict-blocked", deskConflict.blocked && deskConflict.intent === null && deskConflict.agents.some((a) => a.id === "bull" && a.stance === "support") && deskConflict.agents.some((a) => a.id === "bear" && a.stance === "block"), deskConflict.blockReasons[0] ?? ""),
    check("desk", "crypto-arb-negative", arb.netBps < 0 && arb.take === false, `Net ${arb.netBps} bps.`),
    check("desk", "futures-closed", fut.take === false && instrument("MESZ26")?.paperEligible === false, fut.reason),
    check("desk", "prediction-closed", runDesk(session, "prediction").blocked && instrument("EVT-DEMO")?.contract?.resolutionAmbiguous === true, "Ambiguous resolution stays blocked."),
    check("desk", "mechanics-needs-paper", runDesk(initialBook(), "mechanics").blocked && runDesk(session, "mechanics").risk?.approved === true, "Research blocks the pipe. Paper can approve a sized ticket."),
    check(
      "broker",
      "paper-host-only",
      runPaperSafety().passed && promoteLaunch("MONITORING", "LIVE", { safetyPassed: true, paperAccountConfirmed: true, reconciliationClean: true, operatorApprovedAuto: true }).ok === false,
      runPaperSafety().failed.join(" ") || "Live stays unselectable and the paper allowlist holds.",
    ),
  );

  const failed = checks.filter((c) => !c.passed);
  return { checks, passed: checks.length - failed.length, failed: failed.length };
}
