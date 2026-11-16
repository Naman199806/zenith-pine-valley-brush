/**
 * Report execution outcomes through the existing Hermes journal.
 * Authorization is not consumed. Notes record reconciliation and say
 * when an uncertain order was not resubmitted.
 */

import type { IntentRecord } from "../../../src/lib/apex/live/executor.ts";
import { HermesJournal } from "../../../src/lib/apex/live/journal.ts";
import { worstCaseNotional } from "../../../src/lib/apex/live/equity.ts";
import type { PositionState } from "./lifecycle.ts";

export interface ReportOrder {
  clientOrderId: string;
  symbol: "SPY";
  side: "buy" | "sell";
  qty: number;
  limitPrice: number;
  expiresAt: string;
  linkedEntryId: string | null;
  state: PositionState;
  filledQty: number;
  avgPrice: number | null;
  purpose: "ENTRY" | "EXIT" | "STOP";
  orderType: "limit" | "stop" | "stop_limit";
}

function hermesStatus(state: PositionState): IntentRecord["status"] {
  switch (state) {
    case "PROPOSED":
    case "SUBMISSION_ATTEMPTED":
    case "EXIT_PENDING":
      return "PERSISTED";
    case "PARTIAL":
      return "PARTIAL";
    case "OPEN":
    case "FLAT":
    case "CLOSED":
      return "FILLED";
    case "UNKNOWN":
      return "UNKNOWN";
  }
}

function intent(order: ReportOrder, nowIso: string): IntentRecord {
  return {
    clientOrderId: order.clientOrderId,
    ticket: {
      category: "CONNECTIVITY_TEST",
      symbol: order.symbol,
      side: order.side,
      orderType: "limit",
      maxNotional: 25,
      expiry: order.expiresAt,
      singleUseId: order.clientOrderId,
      readAuthorized: true,
      orderAuthorized: false,
      confirmed: false,
    },
    createdAt: nowIso,
    status: "PERSISTED",
    filledQty: order.filledQty,
    avgPrice: order.avgPrice,
    paperState: "AUTHORIZED",
    linkedClientOrderId: order.linkedEntryId ?? undefined,
    equityIdentity: {
      symbol: order.symbol,
      side: order.side,
      orderType: "limit",
      qty: order.qty,
      limitPrice: order.limitPrice,
      timeInForce: "day",
      session: "REGULAR",
      extendedHours: false,
      singleUseId: order.clientOrderId,
      expiry: order.expiresAt,
      worstCaseNotional: worstCaseNotional(order.qty, order.limitPrice),
    },
  };
}

export function reportToHermes(journal: HermesJournal, order: ReportOrder, nowIso: string, note: string): void {
  if (!journal.get(order.clientOrderId)) journal.persist(intent(order, nowIso));
  const tagged = `${note}; purpose=${order.purpose}; orderType=${order.orderType}`;
  journal.updateStatus(order.clientOrderId, hermesStatus(order.state), order.filledQty, order.avgPrice, tagged);
}

export function reportReconcile(journal: HermesJournal, order: ReportOrder, brokerStatus: string, nowIso: string): void {
  if (!journal.get(order.clientOrderId)) journal.persist(intent(order, nowIso));
  journal.reconcileByClientOrderId(order.clientOrderId, brokerStatus, order.filledQty);
  journal.updateStatus(
    order.clientOrderId,
    hermesStatus(order.state),
    order.filledQty,
    order.avgPrice,
    `lifecycle=${order.state}; purpose=${order.purpose}; no blind retry`,
  );
}
