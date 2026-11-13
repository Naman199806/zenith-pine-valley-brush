import { sizeFractionalOrder, sizePaperOrder } from "../../src/lib/apex/broker/risk-paper.ts";

const base = {
  equityCents: 10_544_280,
  cashCents: 10_544_280,
  entryPriceCents: 7_140_465,
  stopPriceCents: 7_069_060,
  openPositions: 0,
  entriesToday: 0,
  dayDrawdown: 0,
  side: "buy" as const,
  dataOk: true,
  emergency: false,
  duplicate: false,
  closing: false,
  minuteEt: 11 * 60,
};
const crypto = sizeFractionalOrder({
  ...base,
  increment: 0.0001,
  minQty: 0.0001,
  minNotionalCents: 100,
  feeBps: 10,
  applyEquityCutoff: false,
});
const equity = sizePaperOrder(base);
const noExit = sizeFractionalOrder({
  ...base,
  increment: 0.0001,
  minQty: 0.0001,
  minNotionalCents: 100,
  feeBps: 10,
  applyEquityCutoff: false,
  stopPriceCents: base.entryPriceCents,
});
console.log(JSON.stringify({ crypto, equityQty: equity.qty, equityReasons: equity.reasons, noExitApproved: noExit.approved }, null, 2));
