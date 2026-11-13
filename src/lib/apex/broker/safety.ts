import { assertPaperUrl, tradingOriginGuard } from "./allowlist.ts";
import { maySubmit, promoteLaunch } from "./launch.ts";
import { PAPER_RISK, sizePaperOrder } from "./risk-paper.ts";

export function runPaperSafety(): { passed: boolean; failed: string[] } {
  const failed: string[] = [];
  try {
    assertPaperUrl("https://api.alpaca.markets/v2/account");
    failed.push("live host was allowed");
  } catch {
    /* the live host must throw */
  }
  try {
    assertPaperUrl("https://paper-api.alpaca.markets/v2/account");
  } catch {
    failed.push("paper account url was blocked");
  }
  try {
    assertPaperUrl("wss://stream.data.alpaca.markets/v2/sip");
    failed.push("SIP stream was allowed");
  } catch {
    /* SIP stays off */
  }
  if (!tradingOriginGuard("https://api.alpaca.markets").blockOrders) failed.push("live base URL did not block orders");
  const blocked = sizePaperOrder({
    equityCents: 100_000_000,
    cashCents: 100_000_000,
    entryPriceCents: 50_000,
    stopPriceCents: 49_000,
    openPositions: 0,
    entriesToday: 0,
    dayDrawdown: PAPER_RISK.blockDrawdown,
    minuteEt: 10 * 60,
    side: "buy",
    dataOk: true,
    emergency: false,
    duplicate: false,
    closing: false,
  });
  if (blocked.qty !== 0) failed.push("0.5% drawdown did not block");
  const late = sizePaperOrder({ ...blockedInput(), minuteEt: PAPER_RISK.entryCutoffMinute });
  if (late.qty !== 0) failed.push("3:00 PM ET did not block");
  if (promoteLaunch("MONITORING", "LIVE", goodFacts()).ok) failed.push("live mode was selectable");
  if (promoteLaunch("MONITORING", "PAPER_MANUAL", { ...goodFacts(), paperAccountConfirmed: false }).ok) failed.push("manual armed without an account");
  if (promoteLaunch("MONITORING", "PAPER_AUTO", goodFacts()).ok) failed.push("auto skipped manual");
  if (maySubmit("MONITORING", true, true) === null) failed.push("monitoring was allowed to send");
  return { passed: failed.length === 0, failed };
}

function goodFacts() {
  return { safetyPassed: true, paperAccountConfirmed: true, reconciliationClean: true, operatorApprovedAuto: true };
}

function blockedInput() {
  return {
    equityCents: 100_000_000,
    cashCents: 100_000_000,
    entryPriceCents: 50_000,
    stopPriceCents: 49_000,
    openPositions: 0,
    entriesToday: 0,
    dayDrawdown: 0,
    minuteEt: 10 * 60,
    side: "buy" as const,
    dataOk: true,
    emergency: false,
    duplicate: false,
    closing: false,
  };
}
