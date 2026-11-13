/** Stricter than the fixture simulator. These limits apply only to the Alpaca paper session. */

export const PAPER_RISK = {
  maxRiskFraction: 0.001,
  maxNotionalFraction: 0.05,
  maxPositions: 3,
  maxEntriesPerSession: 5,
  blockDrawdown: 0.005,
  emergencyDrawdown: 0.01,
  entryCutoffMinute: 15 * 60,
  flattenMinute: 15 * 60 + 55,
  maxSpreadBps: 10,
  minBarVolume: 1000,
  alpacaCryptoTakerBps: 25,
  alpacaCryptoMakerBps: 15,
} as const;

export interface SizeInput {
  equityCents: number;
  cashCents: number;
  entryPriceCents: number;
  stopPriceCents: number;
  openPositions: number;
  entriesToday: number;
  dayDrawdown: number;
  minuteEt: number;
  side: "buy" | "sell";
  dataOk: boolean;
  emergency: boolean;
  duplicate: boolean;
  closing: boolean;
}

export interface SizeResult {
  qty: number;
  reasons: string[];
  emergency: boolean;
}

export interface FractionalSizeInput extends SizeInput {
  increment: number;
  minQty: number;
  minNotionalCents: number;
  feeBps: number;
  applyEquityCutoff: boolean;
}

export interface FractionalSizeResult {
  qty: string;
  notionalCents: number;
  riskCents: number;
  binding: "risk" | "notional" | "cash" | "rejected";
  reasons: string[];
  approved: boolean;
}

function floorToIncrement(value: number, increment: number): number {
  if (!(increment > 0)) return 0;
  return Math.floor(value / increment) * increment;
}

/** Fractional sizing for crypto and fractionable equities. Does not replace sizePaperOrder. */
export function sizeFractionalOrder(input: FractionalSizeInput): FractionalSizeResult {
  const reasons: string[] = [];
  if (input.side === "sell" && !input.closing) reasons.push("Short selling is not allowed.");
  if (!input.dataOk) reasons.push("Market data is missing, stale, or wider than 10 bps.");
  if (input.duplicate) reasons.push("Duplicate order.");
  if (!(input.cashCents > 0) && !input.closing) reasons.push("No cash is available.");
  if (input.applyEquityCutoff && !input.closing && input.minuteEt >= PAPER_RISK.entryCutoffMinute) {
    reasons.push("No new entries after 3:00 PM ET.");
  }
  if (!input.closing && input.dayDrawdown >= PAPER_RISK.blockDrawdown) reasons.push("New risk is blocked at 0.5% daily drawdown.");
  if (!(input.increment > 0) || !(input.minQty > 0)) reasons.push("Instrument increment and minimum quantity are required.");
  const stopDist = input.entryPriceCents - input.stopPriceCents;
  if (!(stopDist > 0) || !(input.entryPriceCents > 0)) {
    reasons.push("A valid exit below the entry is required. Autonomous execution is rejected.");
  }
  if (reasons.length) return { qty: "0", notionalCents: 0, riskCents: 0, binding: "rejected", reasons, approved: false };

  const riskBudget = Math.floor(input.equityCents * PAPER_RISK.maxRiskFraction);
  const fee = input.feeBps / 10_000;
  const costPerUnit = stopDist + input.entryPriceCents * fee * 2;
  let qty = floorToIncrement(riskBudget / costPerUnit, input.increment);
  const cap = Math.floor(input.equityCents * PAPER_RISK.maxNotionalFraction);
  while (qty > 0 && qty * input.entryPriceCents > cap) qty = floorToIncrement(qty - input.increment, input.increment);
  while (qty > 0 && qty * input.entryPriceCents > input.cashCents) qty = floorToIncrement(qty - input.increment, input.increment);
  if (qty < input.minQty) {
    return { qty: "0", notionalCents: 0, riskCents: 0, binding: "rejected", reasons: ["Quantity is below the instrument minimum after risk and notional caps."], approved: false };
  }
  const notional = Math.round(qty * input.entryPriceCents);
  if (notional < input.minNotionalCents) {
    return { qty: "0", notionalCents: 0, riskCents: 0, binding: "rejected", reasons: ["Notional is below the venue minimum."], approved: false };
  }
  const binding = notional >= cap - input.entryPriceCents * input.increment ? "notional" : "risk";
  return {
    qty: qty.toFixed(8).replace(/0+$/, "").replace(/\.$/, ""),
    notionalCents: notional,
    riskCents: Math.round(qty * costPerUnit),
    binding,
    reasons: [],
    approved: true,
  };
}

export function sizePaperOrder(input: SizeInput): SizeResult {
  const reasons: string[] = [];
  const emergency = input.emergency || input.dayDrawdown >= PAPER_RISK.emergencyDrawdown;
  if (emergency && !input.closing) reasons.push("Emergency stop. Daily drawdown is at 1%, or the operator stopped the session. Liquidation is not guaranteed.");
  if (input.side === "sell" && !input.closing) reasons.push("Short selling is not allowed.");
  if (input.side === "buy" && input.closing) reasons.push("A close must be a sell of an existing long.");
  if (!input.dataOk) reasons.push("Market data is missing, stale, or wider than 10 bps.");
  if (input.duplicate) reasons.push("Duplicate order.");
  if (!(input.cashCents > 0) && !input.closing) reasons.push("No cash is available.");
  if (!input.closing && input.minuteEt >= PAPER_RISK.entryCutoffMinute) reasons.push("No new entries after 3:00 PM ET.");
  if (!input.closing && input.dayDrawdown >= PAPER_RISK.blockDrawdown) reasons.push("New risk is blocked at 0.5% daily drawdown.");
  if (!input.closing && input.openPositions >= PAPER_RISK.maxPositions) reasons.push("Three positions are already open.");
  if (!input.closing && input.entriesToday >= PAPER_RISK.maxEntriesPerSession) reasons.push("Five entries have already been taken today.");
  if (reasons.length) return { qty: 0, reasons, emergency };

  if (input.closing) return { qty: 0, reasons: [], emergency };

  const riskCents = Math.floor(input.equityCents * PAPER_RISK.maxRiskFraction);
  const stopDist = input.entryPriceCents - input.stopPriceCents;
  if (!(riskCents > 0) || !(stopDist > 0) || !(input.entryPriceCents > 0)) {
    return { qty: 0, reasons: ["The stop must sit below the entry, and equity has to be positive."], emergency };
  }
  let qty = Math.floor(riskCents / stopDist);
  const cap = Math.floor(input.equityCents * PAPER_RISK.maxNotionalFraction);
  while (qty > 0 && qty * input.entryPriceCents > cap) qty -= 1;
  while (qty > 0 && qty * input.entryPriceCents > input.cashCents) qty -= 1;
  if (qty < 1) return { qty: 0, reasons: ["The 0.10% risk budget or the 5% notional cap is smaller than one share."], emergency };
  return { qty, reasons: [], emergency };
}
