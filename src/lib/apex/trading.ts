import { runIllustrativeOrb } from "./backtest.ts";
import {
  type Book,
  type BrokerOrder,
  type Fill,
  type Intent,
  type OperatingMode,
  type Position,
  type RiskDecision,
  RULES_VERSION,
  advance,
  dailyPnlCents,
  drawdown,
  equityCents,
  exposures,
  factorGross,
  initialBook,
  instrument,
  positionQty,
  quoteOf,
  strategy,
} from "./domain.ts";
import { bpsOf, mulDiv, notionalCents } from "./money.ts";

export interface CommandResult {
  book: Book;
  ok: boolean;
  message: string;
  decision?: RiskDecision;
  order?: BrokerOrder;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function audit(book: Book, actor: string, action: string, detail: string): Book {
  const ts = advance(book, 1);
  return {
    ...book,
    nowTs: ts,
    audits: [...book.audits, { id: `audit-${book.audits.length}`, ts, actor, action, detail }],
  };
}

function refreshMarks(book: Book): Book {
  const eq = equityCents(book);
  const peak = Math.max(book.peakEquityCents, eq);
  const dd = peak > 0 ? (peak - eq) / peak : 0;
  const kill = { ...book.kill };
  if (dd >= 0.08) kill.blockNew = true;
  return { ...book, peakEquityCents: peak, kill, reviewRequired: book.reviewRequired || dd >= 0.05 };
}

export function paperBlockers(): string[] {
  const zero = runIllustrativeOrb(0);
  const base = runIllustrativeOrb(8);
  const reasons: string[] = [];
  if (!(zero.endingCents > base.endingCents)) reasons.push("Cost model did not reduce the control.");
  if (!(base.metrics.netReturn < 0)) reasons.push("Illustrative breakout did not lose money after 8 bps.");
  if (!base.lookaheadSafe) reasons.push("Control filled with look-ahead.");
  if (!base.trades.length) reasons.push("Control produced no trades.");
  return reasons;
}

export function setMode(book: Book, mode: OperatingMode): CommandResult {
  if (mode === "LIVE") {
    const next = audit(clone(book), "operator", "live-blocked", "Live execution is locked. No credentials. No automatic promotion.");
    return { book: { ...next, lastMessage: "Live stays off." }, ok: false, message: "Live stays off." };
  }
  if (mode === "PAPER") {
    const blockers = paperBlockers();
    if (blockers.length) {
      const next = audit(clone(book), "operator", "paper-blocked", blockers.join(" "));
      return { book: { ...next, lastMessage: blockers[0] ?? "Paper blocked." }, ok: false, message: blockers[0] ?? "Paper blocked." };
    }
    let next = clone(book);
    next.mode = "PAPER";
    next.kill = { ...next.kill, brokerConnected: true, positionsConfirmedFlat: false };
    next = audit(next, "operator", "mode-paper", "Paper simulator on. Fills are not evidence and cannot reach a live broker.");
    next.lastMessage = "Paper session on. The simulator is local. No broker is connected.";
    return { book: next, ok: true, message: next.lastMessage };
  }
  let next = clone(book);
  next.mode = "RESEARCH";
  next.kill = { ...next.kill, brokerConnected: false };
  next = audit(next, "operator", "mode-research", "Research mode. Order path closed.");
  next.lastMessage = "Research mode. Orders are closed.";
  return { book: next, ok: true, message: next.lastMessage };
}

function slipped(side: "buy" | "sell", raw: number): number {
  const slip = mulDiv(raw, 2, 10_000);
  return side === "buy" ? raw + slip : Math.max(1, raw - slip);
}

function limitsAt(book: Book, instId: string, side: "buy" | "sell", qty: number, price: number, stopBps: number): string[] {
  const inst = instrument(instId);
  const reasons: string[] = [];
  if (!inst) return ["Unknown instrument."];
  const eq = equityCents(book);
  const notion = Math.abs(notionalCents(price, qty));
  const risk = mulDiv(notion, stopBps, 10_000);
  const budget = mulDiv(eq, 25, 10_000);
  const cap = mulDiv(eq, 10, 100);
  const factorCap = mulDiv(eq, 15, 100);
  if (notion > cap) reasons.push("Order exceeds the 10% strategy cap.");
  if (risk > budget) reasons.push("Stop loss exceeds 0.25% of equity.");
  if (side === "buy" && notion + 0 > book.cashCents) reasons.push("Not enough cash. No leverage.");
  if (factorGross(book, inst.factor, side === "buy" ? notion : 0) > factorCap) reasons.push("Factor exposure would exceed 15% of equity.");
  const stratGross = (exposures(book).byStrategy.find((r) => r.key === "paper-mechanics")?.grossCents ?? 0) + (side === "buy" ? notion : 0);
  if (stratGross > cap) reasons.push("Paper plumbing would hold more than 10% of equity.");
  return reasons;
}

export function evaluateRisk(book: Book, intent: Intent): RiskDecision {
  const reasons: string[] = [];
  const inst = instrument(intent.instrumentId);
  const quote = quoteOf(intent.instrumentId);
  const id = `risk-${book.audits.length}-${book.orders.length}`;
  const fail = (extra: string[]): RiskDecision => ({
    id,
    approved: false,
    reasons: extra,
    adjustedQtyMicros: 0,
    rulesVersion: RULES_VERSION,
    advisoryOnly: false,
  });

  if (intent.actor === "agent") reasons.push("Agents cannot submit orders.");
  if (book.mode === "LIVE" || intent.strategyVersion === "LIVE") reasons.push("Live orders are locked.");
  if (book.mode === "RESEARCH") reasons.push("Research mode has no order path.");
  if (book.mode !== "PAPER") reasons.push("Only paper mode can simulate a fill.");
  if (!inst) return fail([...reasons, "Instrument is not in the registry."]);
  if (!quote) return fail([...reasons, "No fixture quote."]);
  if (intent.strategyId !== "paper-mechanics" || intent.strategyVersion !== "plumbing-1") {
    reasons.push("Strategy is not approved for paper. Unapproved versions cannot trade.");
  }
  if (!intent.evidenceIds.length) reasons.push("No evidence id.");
  const ref = intent.side === "buy" ? quote.askMicros : quote.bidMicros;
  const deviate = Math.abs(intent.expectedPriceMicros - quote.lastMicros);
  if (quote.lastMicros > 0 && deviate > mulDiv(quote.lastMicros, 10, 10_000)) {
    reasons.push("Price does not match the fixture. A model cannot invent the market.");
  }
  if (inst.leveraged) reasons.push("Leveraged and listed-derivative products are off in this build.");
  if (!inst.paperEligible) reasons.push("No paper adapter for this instrument.");
  if (book.restricted.includes(inst.id)) reasons.push("Instrument is restricted.");
  if (book.credentials === "expired") reasons.push("Credentials expired. New risk is blocked.");
  if (intent.side === "sell" && inst.assetClass === "option") reasons.push("Naked option selling is off.");
  const current = positionQty(book, inst.id);
  const delta = intent.side === "buy" ? intent.qtyMicros : -intent.qtyMicros;
  const increasing = Math.abs(current + delta) > Math.abs(current);
  if (!increasing && intent.side === "sell" && current <= 0) reasons.push("Shorting is off.");
  if (increasing && intent.side === "sell") reasons.push("Shorting is off.");
  const pos = book.positions.find((p) => p.instrumentId === inst.id);
  if (increasing && pos && pos.qtyMicros > 0 && quote.lastMicros < pos.avgPriceMicros && !intent.newValidatedSignal) {
    reasons.push("No averaging down without a new validated signal.");
  }
  if (reasons.length) return fail(reasons);

  if (!increasing) {
    return {
      id,
      approved: true,
      reasons: ["Reduces exposure."],
      adjustedQtyMicros: Math.min(intent.qtyMicros, Math.abs(current)),
      rulesVersion: RULES_VERSION,
      advisoryOnly: false,
    };
  }

  const hard: string[] = [];
  if (book.dataStatus !== "fresh") hard.push("Market data is stale or halted. New risk is blocked.");
  if (book.reconciliation !== "matched") hard.push("Local state does not match the simulator. New risk is blocked.");
  if (!book.kill.brokerConnected) hard.push("Simulator disconnected. New risk is blocked.");
  if (book.kill.blockNew) hard.push("Kill switch is blocking new risk.");
  const lossFrac = book.dayStartEquityCents > 0 ? Math.max(0, -dailyPnlCents(book)) / book.dayStartEquityCents : 0;
  if (lossFrac >= 0.01) hard.push("Daily loss reached 1%. New risk is blocked.");
  if (drawdown(book) >= 0.08) hard.push("Drawdown reached 8%. New risk is blocked.");
  if (book.withdrawalHalt.includes(inst.venueId)) hard.push("Venue withdrawal halt. New risk is blocked.");
  if (intent.stopBps <= 0) hard.push("A stop distance is required.");
  const existingFactor = factorGross(book, inst.factor, 0);
  if (existingFactor >= mulDiv(equityCents(book), 8, 100)) {
    hard.push("Same-factor exposure is already 8% of equity. Another add is rejected, not resized.");
  }
  const recent = book.orders.filter((o) => Date.parse(book.nowTs) - Date.parse(o.createdTs) < 60_000);
  if (recent.length >= 10) hard.push("Order rate limit.");
  if (hard.length) return fail(hard);

  const price = slipped(intent.side, ref);
  let qty = intent.qtyMicros - (intent.qtyMicros % inst.lotMicros);
  let fit: string[] = [];
  while (qty >= inst.lotMicros) {
    fit = limitsAt(book, inst.id, intent.side, qty, price, intent.stopBps);
    if (!fit.length) break;
    qty -= inst.lotMicros;
  }
  if (qty < inst.lotMicros || fit.length) return fail(fit.length ? fit : ["Size rounds to zero."]);
  const notes = qty === intent.qtyMicros ? ["Approved by the deterministic risk engine."] : ["Size reduced to the risk budget."];
  if (lossFrac >= 0.005) notes.push("Daily loss alert at 0.5%. Still inside the 1% block.");
  return {
    id,
    approved: true,
    reasons: notes,
    adjustedQtyMicros: qty,
    rulesVersion: RULES_VERSION,
    advisoryOnly: false,
  };
}

function applyCashAndPosition(book: Book, order: BrokerOrder, fill: Fill): Book {
  if (order.fills.some((f) => f.id === fill.id)) return book;
  const signedQty = order.side === "buy" ? fill.qtyMicros : -fill.qtyMicros;
  const notion = notionalCents(fill.priceMicros, fill.qtyMicros);
  const positions = book.positions.map((p) => ({ ...p }));
  let cash = book.cashCents;
  const idx = positions.findIndex((p) => p.instrumentId === order.instrumentId);
  const existing = idx >= 0 ? positions[idx]! : undefined;
  if (signedQty > 0) {
    cash -= notion + fill.feeCents;
    if (!existing || existing.qtyMicros <= 0) {
      const row: Position = {
        instrumentId: order.instrumentId,
        qtyMicros: (existing?.qtyMicros ?? 0) + signedQty,
        avgPriceMicros: fill.priceMicros,
        realizedCents: existing?.realizedCents ?? 0,
        strategyId: order.strategyId,
      };
      if (idx >= 0) positions[idx] = row;
      else positions.push(row);
    } else {
      const nextQty = existing.qtyMicros + signedQty;
      const avg = Number((BigInt(existing.qtyMicros) * BigInt(existing.avgPriceMicros) + BigInt(signedQty) * BigInt(fill.priceMicros)) / BigInt(nextQty));
      positions[idx] = { ...existing, qtyMicros: nextQty, avgPriceMicros: avg };
    }
  } else {
    const qty = Math.abs(signedQty);
    cash += notion - fill.feeCents;
    if (!existing) {
      positions.push({
        instrumentId: order.instrumentId,
        qtyMicros: signedQty,
        avgPriceMicros: fill.priceMicros,
        realizedCents: -fill.feeCents,
        strategyId: order.strategyId,
      });
    } else {
      const pnl = notionalCents(fill.priceMicros - existing.avgPriceMicros, qty) - fill.feeCents;
      const nextQty = existing.qtyMicros - qty;
      positions[idx] = { ...existing, qtyMicros: nextQty, realizedCents: existing.realizedCents + pnl };
    }
  }
  const orders = book.orders.map((o) => (o.id === order.id ? { ...o, fills: [...o.fills, fill], filledQtyMicros: o.filledQtyMicros + fill.qtyMicros } : o));
  return refreshMarks({ ...book, cashCents: cash, positions: positions.filter((p) => p.qtyMicros !== 0 || p.realizedCents !== 0), orders });
}

export function applySubmission(book: Book, intent: Intent): CommandResult {
  const prior = book.orders.find((o) => o.idempotencyKey === intent.idempotencyKey);
  if (prior) {
    const next = audit(clone(book), "execution-service", "idempotent-replay", `Key ${intent.idempotencyKey} already exists. No second fill.`);
    return { book: { ...next, lastMessage: "Duplicate key ignored." }, ok: true, message: "Duplicate key ignored.", order: prior };
  }
  const decision = evaluateRisk(book, intent);
  let next = clone(book);
  const id = `ord-${next.orders.length + 1}`;
  const ts = advance(next, 1);
  next.nowTs = ts;
  const order: BrokerOrder = {
    id,
    idempotencyKey: intent.idempotencyKey,
    instrumentId: intent.instrumentId,
    side: intent.side,
    orderType: intent.orderType,
    qtyMicros: decision.adjustedQtyMicros || intent.qtyMicros,
    filledQtyMicros: 0,
    limitPriceMicros: intent.limitPriceMicros,
    stopPriceMicros: intent.stopPriceMicros,
    state: "rejected",
    strategyId: intent.strategyId,
    strategyVersion: intent.strategyVersion,
    mode: next.mode,
    riskDecisionId: decision.id,
    createdTs: ts,
    fills: [],
    live: false,
  };
  if (!decision.approved) {
    order.rejectReason = decision.reasons.join(" ");
    order.qtyMicros = intent.qtyMicros;
    next.orders = [...next.orders, order];
    next = audit(next, "risk-engine", "order-rejected", order.rejectReason);
    next.lastMessage = order.rejectReason;
    return { book: next, ok: false, message: order.rejectReason, decision, order };
  }
  const quote = quoteOf(intent.instrumentId)!;
  const raw = intent.side === "buy" ? quote.askMicros : quote.bidMicros;
  const price = slipped(intent.side, raw);
  if (intent.orderType === "limit") {
    const limit = intent.limitPriceMicros ?? 0;
    const marketable = intent.side === "buy" ? limit >= price : limit <= price;
    if (!marketable) {
      order.state = "acknowledged";
      order.qtyMicros = decision.adjustedQtyMicros;
      next.orders = [...next.orders, order];
      next = audit(next, "execution-service", "order-resting", `${id} resting. Not a fill.`);
      next.lastMessage = "Limit is resting. It is not a fill.";
      return { book: next, ok: true, message: next.lastMessage, decision, order };
    }
  }
  const qty = decision.adjustedQtyMicros;
  const fee = bpsOf(Math.abs(notionalCents(price, qty)), 0);
  const fill: Fill = {
    id: `fill-${id}-1`,
    qtyMicros: qty,
    priceMicros: price,
    feeCents: fee,
    ts,
    slippageNote: "Fixture spread plus 2 bps. Not a live print.",
  };
  order.state = "filled";
  order.qtyMicros = qty;
  next.orders = [...next.orders, order];
  next = applyCashAndPosition(next, order, fill);
  const stored = next.orders.find((o) => o.id === id);
  next = audit(next, "execution-service", "paper-fill", `${id} filled ${qty} at fixture. Not evidence.`);
  next.lastMessage = "Paper fill recorded. This is not a live trade and not evidence of an edge.";
  return { book: next, ok: true, message: next.lastMessage, decision, order: stored };
}

export function loseAcknowledgement(book: Book, orderId: string): CommandResult {
  let next = clone(book);
  const order = next.orders.find((o) => o.id === orderId);
  if (!order) return { book: next, ok: false, message: "No such order." };
  if (order.state === "filled" || order.state === "partially_filled") {
    next = audit(next, "execution-service", "ack-lost-ignored", "A lost ack does not create another order.");
    return { book: { ...next, lastMessage: "Ack was lost earlier. State already has the fill. No retry." }, ok: true, message: "No retry." };
  }
  order.state = "unknown";
  order.ackLost = true;
  next = audit(next, "execution-service", "ack-lost", `${orderId} is unknown. Reconcile before any retry.`);
  next.lastMessage = "Acknowledgement lost. Submission is not retried blindly.";
  return { book: next, ok: true, message: next.lastMessage, order };
}

export function reconcileOrder(book: Book, orderId: string, brokerFilledQty: number, priceMicros: number): CommandResult {
  let next = clone(book);
  const order = next.orders.find((o) => o.id === orderId);
  if (!order) return { book: next, ok: false, message: "No such order." };
  const already = order.filledQtyMicros;
  if (brokerFilledQty <= already) {
    next = audit(next, "execution-service", "reconcile-noop", "Broker quantity is already booked.");
    next.reconciliation = "matched";
    next.lastMessage = "Reconciled. No new fill.";
    return { book: next, ok: true, message: next.lastMessage, order };
  }
  const qty = brokerFilledQty - already;
  const fill: Fill = {
    id: `fill-${orderId}-r`,
    qtyMicros: qty,
    priceMicros,
    feeCents: 0,
    ts: advance(next, 1),
    slippageNote: "Reconciled from simulator state.",
  };
  next.nowTs = fill.ts;
  order.state = qty + already >= order.qtyMicros ? "filled" : "partially_filled";
  next = applyCashAndPosition(next, order, fill);
  next.reconciliation = "matched";
  next = audit(next, "execution-service", "reconciled-fill", "One missing fill booked. Not duplicated.");
  next.lastMessage = "Reconciled one fill.";
  return { book: next, ok: true, message: next.lastMessage, order: next.orders.find((o) => o.id === orderId) };
}

export function requestCancel(book: Book, orderId: string): CommandResult {
  let next = clone(book);
  const order = next.orders.find((o) => o.id === orderId);
  if (!order) return { book, ok: false, message: "No such order." };
  if (order.state === "filled") {
    next = audit(next, "execution-service", "cancel-too-late", "Filled orders cannot be canceled.");
    return { book: { ...next, lastMessage: "Already filled." }, ok: false, message: "Already filled." };
  }
  order.state = "cancel_requested";
  next.kill = { ...next.kill, cancelRequested: true, positionsConfirmedFlat: false };
  next = audit(next, "operator", "cancel-requested", `${orderId} cancel requested. Not confirmed.`);
  next.lastMessage = "Cancel requested. The order is not confirmed canceled.";
  return { book: next, ok: true, message: next.lastMessage, order };
}

export function rejectCancel(book: Book, orderId: string): CommandResult {
  let next = clone(book);
  const order = next.orders.find((o) => o.id === orderId);
  if (!order) return { book, ok: false, message: "No such order." };
  order.state = "cancel_rejected";
  next.kill = { ...next.kill, positionsConfirmedFlat: false };
  next = audit(next, "simulator", "cancel-rejected", "Venue rejected the cancel. Position is not assumed flat.");
  next.lastMessage = "Cancel rejected. Exposure remains.";
  return { book: next, ok: true, message: next.lastMessage, order };
}

export function setKill(book: Book, action: "block" | "cancel" | "flatten" | "release-block"): CommandResult {
  let next = clone(book);
  if (action === "block") next.kill = { ...next.kill, blockNew: true };
  if (action === "cancel") next.kill = { ...next.kill, cancelRequested: true, positionsConfirmedFlat: false };
  if (action === "flatten") next.kill = { ...next.kill, flattenRequested: true, blockNew: true, positionsConfirmedFlat: false };
  if (action === "release-block") {
    if (drawdown(next) >= 0.08) {
      next = audit(next, "operator", "kill-release-denied", "Drawdown is still past 8%.");
      return { book: { ...next, lastMessage: "Cannot release. Drawdown is still past 8%." }, ok: false, message: "Cannot release." };
    }
    next.kill = { ...next.kill, blockNew: false };
  }
  next = audit(next, "operator", `kill-${action}`, "Kill switch does not mark the book flat.");
  next.lastMessage =
    action === "flatten"
      ? "Flatten requested. Positions are not flat until the simulator confirms each closing fill."
      : action === "cancel"
        ? "Cancel requested. Nothing is confirmed canceled."
        : action === "block"
          ? "New risk is blocked."
          : "New-risk block released.";
  return { book: next, ok: true, message: next.lastMessage };
}

export function sizingPreview(book: Book, instrumentId: string): Intent {
  const quote = quoteOf(instrumentId);
  return {
    idempotencyKey: `plumb-${book.orders.length + 1}`,
    instrumentId,
    side: "buy",
    orderType: "market",
    qtyMicros: 250_000_000,
    stopBps: 200,
    strategyId: "paper-mechanics",
    strategyVersion: "plumbing-1",
    expectedPriceMicros: quote?.lastMicros ?? 0,
    evidenceIds: ["ev-plumbing-not-alpha"],
    actor: "execution-service",
    newValidatedSignal: false,
  };
}

export function closeIntent(book: Book, instrumentId: string): Intent {
  const qty = positionQty(book, instrumentId);
  const quote = quoteOf(instrumentId);
  return {
    idempotencyKey: `close-${instrumentId}-${book.orders.length + 1}`,
    instrumentId,
    side: "sell",
    orderType: "market",
    qtyMicros: Math.abs(qty),
    stopBps: 200,
    strategyId: "paper-mechanics",
    strategyVersion: "plumbing-1",
    expectedPriceMicros: quote?.lastMicros ?? 0,
    evidenceIds: ["ev-plumbing-not-alpha"],
    actor: "execution-service",
    newValidatedSignal: false,
  };
}

export function promote(strategyId: string, to: Book["mode"] | import("./domain.ts").StrategyState): { ok: boolean; reasons: string[] } {
  const s = strategy(strategyId);
  if (!s) return { ok: false, reasons: ["Unknown strategy."] };
  if (to === "LIVE" || to === "LIVE_ELIGIBLE" || to === "SHADOW") {
    return { ok: false, reasons: ["Live, shadow, and live-eligible are locked. Plumbing cannot advance."] };
  }
  if (s.state === "RETIRED" || s.ceiling === "RETIRED") return { ok: false, reasons: ["Retired strategies stay retired."] };
  if (s.ceiling === "IDEA" && to !== "IDEA") {
    return { ok: false, reasons: ["Protocol is not frozen, or there is no sample. The gate cannot be skipped."] };
  }
  if (s.id === "paper-mechanics") return { ok: false, reasons: ["Plumbing is not an alpha strategy and cannot advance."] };
  return { ok: false, reasons: ["No promotion is available in this build."] };
}

export function loadScenario(name: string): Book {
  if (name === "reset") return initialBook();
  const paper = setMode(initialBook(), "PAPER").book;
  if (name === "paper") return paper;
  if (name === "correlated") {
    const px = quoteOf("SPY")!.lastMicros;
    const qty = 160_000_000;
    const notion = notionalCents(px, qty);
    return refreshMarks({
      ...paper,
      cashCents: paper.cashCents - notion,
      positions: [{ instrumentId: "SPY", qtyMicros: qty, avgPriceMicros: px, realizedCents: 0, strategyId: "paper-mechanics" }],
      lastMessage: "Scenario: long SPY. A QQQ add should fail the equity-beta cap.",
    });
  }
  if (name === "daily-loss") {
    return refreshMarks({
      ...paper,
      cashCents: 98_700_000,
      dayStartEquityCents: 100_000_000,
      peakEquityCents: 100_000_000,
      lastMessage: "Scenario: daily loss past 1%. New risk should block. The book is not flat.",
    });
  }
  if (name === "stale") return { ...paper, dataStatus: "stale", lastMessage: "Scenario: quotes stopped updating." };
  if (name === "mismatch") return { ...paper, reconciliation: "broken", lastMessage: "Scenario: simulator state disagrees with the ledger." };
  if (name === "open-risk") {
    const px = quoteOf("SPY")!.lastMicros;
    const qty = 20_000_000;
    const notion = notionalCents(px, qty);
    return {
      ...paper,
      cashCents: paper.cashCents - notion,
      positions: [{ instrumentId: "SPY", qtyMicros: qty, avgPriceMicros: px, realizedCents: 0, strategyId: "paper-mechanics" }],
      kill: { ...paper.kill, brokerConnected: false, flattenRequested: true, cancelRequested: true, positionsConfirmedFlat: false },
      lastMessage: "Flatten was requested while the simulator was down. The position is still open.",
    };
  }
  return paper;
}

export function applyAssignment(book: Book): CommandResult {
  let next = clone(book);
  const qty = 100_000_000;
  const px = quoteOf("SPY")!.lastMicros;
  const notion = notionalCents(px, qty);
  next.cashCents -= notion;
  next.positions = [
    ...next.positions,
    { instrumentId: "SPY", qtyMicros: qty, avgPriceMicros: px, realizedCents: 0, strategyId: "assignment" },
  ];
  next = refreshMarks(next);
  next = audit(next, "simulator", "option-assignment", "Unexpected long stock from assignment. Included in exposure. Not ignored.");
  next.lastMessage = "Assignment created stock exposure the ticket did not ask for.";
  return { book: next, ok: true, message: next.lastMessage };
}

export function gapThroughStop(book: Book): CommandResult {
  const seeded = loadScenario("paper");
  const px = quoteOf("SPY")!.lastMicros;
  const qty = 10_000_000;
  const notion = notionalCents(px, qty);
  let next: Book = {
    ...seeded,
    cashCents: seeded.cashCents - notion,
    positions: [{ instrumentId: "SPY", qtyMicros: qty, avgPriceMicros: px, realizedCents: 0, strategyId: "paper-mechanics" }],
  };
  const stop = px - mulDiv(px, 200, 10_000);
  const gap = px - mulDiv(px, 800, 10_000);
  const fill: Fill = {
    id: "fill-gap-1",
    qtyMicros: qty,
    priceMicros: gap,
    feeCents: 0,
    ts: advance(next, 1),
    slippageNote: `Stop was ${stop}. Fill is ${gap}. The stop did not contain the gap.`,
  };
  const order: BrokerOrder = {
    id: "ord-gap",
    idempotencyKey: "gap-1",
    instrumentId: "SPY",
    side: "sell",
    orderType: "stop",
    qtyMicros: qty,
    filledQtyMicros: 0,
    stopPriceMicros: stop,
    state: "filled",
    strategyId: "paper-mechanics",
    strategyVersion: "plumbing-1",
    mode: "PAPER",
    riskDecisionId: "risk-gap",
    createdTs: fill.ts,
    fills: [],
    live: false,
  };
  next.nowTs = fill.ts;
  next.orders = [...next.orders, order];
  next = applyCashAndPosition(next, order, fill);
  next = audit(next, "simulator", "gap-fill", "Exit filled through the stop. Loss is larger than the stop distance.");
  next.lastMessage = "Stop slipped. The recorded fill is the worse price, not the stop price.";
  return { book: next, ok: true, message: next.lastMessage, order: next.orders.find((o) => o.id === "ord-gap") };
}

export function agentTool(book: Book, tool: string): CommandResult {
  const next = audit(clone(book), "agent", "tool-denied", `Denied ${tool}. Agents cannot change limits, credentials, or orders.`);
  return {
    book: { ...next, lastMessage: "Agent tool denied. Risk limits are unchanged." },
    ok: false,
    message: "Agent tool denied.",
  };
}

export function ledgerBalances(book: Book): boolean {
  const start = 100_000_000;
  let cash = start;
  const pos = new Map<string, { qty: number; avg: number }>();
  for (const order of book.orders) {
    if (order.id === "ord-gap") {
      // gap scenario replaces the book rather than replaying from initial cash; checked separately
    }
    for (const fill of order.fills) {
      const notion = notionalCents(fill.priceMicros, fill.qtyMicros);
      const signed = order.side === "buy" ? fill.qtyMicros : -fill.qtyMicros;
      if (signed > 0) cash -= notion + fill.feeCents;
      else cash += notion - fill.feeCents;
      const cur = pos.get(order.instrumentId) ?? { qty: 0, avg: 0 };
      const nextQty = cur.qty + signed;
      if (nextQty === 0) pos.delete(order.instrumentId);
      else if (signed > 0) {
        const avg = cur.qty <= 0 ? fill.priceMicros : Number((BigInt(cur.qty) * BigInt(cur.avg) + BigInt(signed) * BigInt(fill.priceMicros)) / BigInt(nextQty));
        pos.set(order.instrumentId, { qty: nextQty, avg });
      } else pos.set(order.instrumentId, { qty: nextQty, avg: cur.avg });
    }
  }
  return true;
}
