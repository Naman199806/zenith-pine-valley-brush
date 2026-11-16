/**
 * Apex Executor process core.
 * Apex Quant X proposes a signed instruction. This service verifies it,
 * checks the broker, journals the decision, and does not invent a side.
 * Alpaca POST stays disabled. Uncertain submits are reconciled by
 * client_order_id and are never retried blindly.
 */

import { redactSecrets } from "../../../src/lib/apex/broker/allowlist.ts";
import { orderFromBroker, resolveUnknownOrder, type BrokerOrder } from "../../../src/lib/apex/broker/client.ts";
import { mapBrokerStatus } from "../../../src/lib/apex/broker/machine.ts";
import { alpacaOrderPayload, type EquityIdentity } from "../../../src/lib/apex/live/equity-adapter.ts";
import { HermesJournal } from "../../../src/lib/apex/live/journal.ts";
import {
  verifyOperatorApproval,
  verifyProtectiveApproval,
  type OperatorApproval,
  type ProtectiveApproval,
  type PostEnableGrant,
} from "../../../src/lib/apex/broker/paper-equity-transport.ts";
import type { EvidenceSource, ExecutorTransport } from "./broker.ts";
import { paperLookupUrl, paperOrderUrl } from "./broker.ts";
import { reportReconcile, reportToHermes } from "./hermes-report.ts";
import { paperTicket, parseInstruction, type TradeInstruction } from "./instruction.ts";
import { OrderJournal, type JournalRecord } from "./journal.ts";
import { fromMachine, isTerminalState, nextLifecycle, type LifecycleState } from "./lifecycle.ts";
import { MODE_GATE, postDecision } from "./mode.ts";
import { assessRisk, type MarketSnapshot } from "./risk.ts";

const RECONCILE_CREDS = { keyId: "PKEXECUTORMOCK", secret: "mock-only-not-a-broker-secret" };

export interface OrderRecord {
  clientOrderId: string;
  nonce: string;
  decisionId: string;
  purpose: TradeInstruction["purpose"];
  symbol: "SPY";
  side: "buy" | "sell";
  orderType: TradeInstruction["orderType"];
  qty: number;
  limitPrice: number;
  stopPrice: number | null;
  expiresAt: string;
  linkedEntryId: string | null;
  state: LifecycleState;
  filledQty: number;
  avgPrice: number | null;
  submitCount: number;
  approval: OperatorApproval | ProtectiveApproval | null;
}

export interface ExecutorOptions {
  journalPath: string;
  hermesPath: string;
  evidence: EvidenceSource;
  operatorSecret: string | null;
  gateSecret: string | null;
  killSwitch?: boolean;
  redact?: string[];
}

export interface HandleResult {
  accepted: boolean;
  reason: string;
  submitted: false;
}

export interface SubmitResult {
  submitted: boolean;
  reason: string;
  state: LifecycleState | null;
  paperTestsPassed: boolean;
}

function blank(reason: string, kind: JournalRecord["kind"]): Omit<JournalRecord, "seq" | "at"> {
  return {
    kind,
    clientOrderId: null,
    nonce: null,
    decisionId: null,
    purpose: null,
    symbol: null,
    side: null,
    orderType: null,
    qty: null,
    limitPrice: null,
    stopPrice: null,
    expiresAt: null,
    linkedEntryId: null,
    state: null,
    filledQty: null,
    avgPrice: null,
    submitCount: null,
    reason,
  };
}

function orderFromEvent(event: JournalRecord): OrderRecord {
  return {
    clientOrderId: event.clientOrderId ?? "",
    nonce: event.nonce ?? "",
    decisionId: event.decisionId ?? "",
    purpose: event.purpose ?? "ENTRY",
    symbol: "SPY",
    side: event.side ?? "buy",
    orderType: event.orderType ?? "limit",
    qty: event.qty ?? 0,
    limitPrice: event.limitPrice ?? 0,
    stopPrice: event.stopPrice,
    expiresAt: event.expiresAt ?? "",
    linkedEntryId: event.linkedEntryId,
    state: "authorized",
    filledQty: 0,
    avgPrice: null,
    submitCount: 0,
    approval: null,
  };
}

function payload(order: OrderRecord): Record<string, unknown> {
  if (order.orderType === "limit") {
    const identity: EquityIdentity = {
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
      worstCaseNotional: order.qty * order.limitPrice,
    };
    return alpacaOrderPayload(identity, order.clientOrderId);
  }
  const body: Record<string, unknown> = {
    symbol: order.symbol,
    side: order.side,
    type: order.orderType,
    qty: order.qty,
    time_in_force: "day",
    client_order_id: order.clientOrderId,
    stop_price: order.stopPrice,
  };
  if (order.orderType === "stop_limit") body.limit_price = order.limitPrice;
  return body;
}

function statusWord(state: LifecycleState): string {
  switch (state) {
    case "partial_fill":
      return "partially_filled";
    case "cancelled":
      return "canceled";
    case "authorized":
    case "submitted":
      return "accepted";
    default:
      return state;
  }
}

export class Executor {
  private journal: OrderJournal;
  private hermes: HermesJournal;
  private orders = new Map<string, OrderRecord>();
  private nonces = new Set<string>();
  private ids = new Set<string>();
  private evidence: EvidenceSource;
  private operatorSecret: string | null;
  private gateSecret: string | null;
  private redact: string[];
  private kill: boolean;
  private reconciled = false;
  private reconcileError: string | null = null;
  paperMockFilled = false;

  constructor(options: ExecutorOptions) {
    this.journal = new OrderJournal(options.journalPath);
    this.hermes = new HermesJournal(options.hermesPath);
    this.evidence = options.evidence;
    this.operatorSecret = options.operatorSecret;
    this.gateSecret = options.gateSecret;
    this.redact = [...(options.redact ?? []), RECONCILE_CREDS.keyId, RECONCILE_CREDS.secret];
    let journalKill = false;
    for (const event of this.journal.replay()) {
      if (event.kind === "kill") journalKill = event.reason !== "off";
      if (event.kind === "accept" && event.clientOrderId && event.nonce) {
        if (this.orders.has(event.clientOrderId)) throw new Error("corrupt journal; duplicate accept");
        this.orders.set(event.clientOrderId, orderFromEvent(event));
        this.nonces.add(event.nonce);
        this.ids.add(event.clientOrderId);
      }
      if (event.kind === "state" && event.clientOrderId) {
        const order = this.orders.get(event.clientOrderId);
        if (!order || !event.state) throw new Error("corrupt journal; state without order");
        order.state = event.state;
        if (event.filledQty != null) order.filledQty = event.filledQty;
        if (event.avgPrice != null) order.avgPrice = event.avgPrice;
        if (event.submitCount != null) order.submitCount = event.submitCount;
      }
    }
    this.kill = options.killSwitch === true || journalKill;
  }

  health(): {
    ok: true;
    service: "apex-executor";
    mode: typeof MODE_GATE.mode;
    paperPost: typeof MODE_GATE.paperPost;
    livePost: typeof MODE_GATE.livePost;
    autonomousStrategyTrading: typeof MODE_GATE.autonomousStrategyTrading;
    strategyApproved: false;
    accepting: boolean;
    killSwitch: boolean;
    reconciliation: "clean" | "blocked";
  } {
    return {
      ok: true,
      service: "apex-executor",
      mode: MODE_GATE.mode,
      paperPost: MODE_GATE.paperPost,
      livePost: MODE_GATE.livePost,
      autonomousStrategyTrading: MODE_GATE.autonomousStrategyTrading,
      strategyApproved: false,
      accepting: this.reconciled && this.evidence.kind !== "unconfigured",
      killSwitch: this.kill,
      reconciliation: this.reconciled ? "clean" : "blocked",
    };
  }

  setKill(enabled: boolean, reason = "operator kill switch"): void {
    this.kill = enabled;
    this.journal.append({ ...blank(enabled ? reason : "off", "kill"), reason: enabled ? "on" : "off" });
  }

  get(clientOrderId: string): OrderRecord | undefined {
    const order = this.orders.get(clientOrderId);
    return order ? { ...order, approval: null } : undefined;
  }

  hasOpenBrokerOrder(): boolean {
    return [...this.orders.values()].some((order) => order.state !== "authorized" && !isTerminalState(order.state));
  }

  async recover(lookup: (clientOrderId: string) => Promise<BrokerOrder | null>): Promise<void> {
    this.journal.append(blank("replay", "recovery"));
    for (const order of this.orders.values()) {
      this.syncHermes(order, "startup replay", null);
      if (order.state === "authorized" || isTerminalState(order.state)) continue;
      try {
        const remote = await lookup(order.clientOrderId);
        if (!remote) {
          this.commit(order, "unknown", order.filledQty, order.avgPrice, "startup reconcile found nothing; not resubmitted", "unknown");
        } else {
          this.commit(order, fromMachine(remote.state), remote.filledQty, order.avgPrice, "startup reconcile by client_order_id; not resubmitted", statusWord(fromMachine(remote.state)));
        }
      } catch (error) {
        this.reconciled = false;
        this.reconcileError = this.safe(error);
        return;
      }
    }
    this.reconciled = true;
    this.reconcileError = null;
  }

  async handle(input: unknown, now = Date.now()): Promise<HandleResult> {
    if (!this.reconciled) {
      return { accepted: false, reason: this.reconcileError ?? "reconciliation incomplete", submitted: false };
    }
    if (this.evidence.kind === "unconfigured") {
      return { accepted: false, reason: "broker verification unavailable", submitted: false };
    }
    const parsed = parseInstruction(input, now, { operator: this.operatorSecret, gate: this.gateSecret });
    if (!parsed.ok) {
      this.journal.append(blank(parsed.reason, "reject"));
      return { accepted: false, reason: parsed.reason, submitted: false };
    }
    const msg = parsed.value;
    if (this.nonces.has(msg.nonce) || this.ids.has(msg.clientOrderId)) {
      return { accepted: false, reason: "replay", submitted: false };
    }
    let snapshot: MarketSnapshot;
    try {
      snapshot = await this.evidence.load(now);
    } catch (error) {
      return { accepted: false, reason: `broker verification failed: ${this.safe(error)}`, submitted: false };
    }
    const entry = msg.linkedEntryId ? this.orders.get(msg.linkedEntryId) : undefined;
    const ownedQty = entry && (entry.state === "filled" || entry.state === "partial_fill") ? entry.filledQty : 0;
    const conflict = [...this.orders.values()].some((order) => {
      if (order.symbol !== msg.symbol || isTerminalState(order.state)) return false;
      return order.purpose === msg.purpose;
    });
    const risk = assessRisk(msg, snapshot, { conflict, ownedQty }, this.kill, now);
    if (risk) {
      this.journal.append(blank(risk, "reject"));
      return { accepted: false, reason: risk, submitted: false };
    }
    const order: OrderRecord = {
      clientOrderId: msg.clientOrderId,
      nonce: msg.nonce,
      decisionId: msg.decisionId,
      purpose: msg.purpose,
      symbol: msg.symbol,
      side: msg.side,
      orderType: msg.orderType,
      qty: msg.qty,
      limitPrice: msg.limitPrice,
      stopPrice: msg.stopPrice,
      expiresAt: msg.expiresAt,
      linkedEntryId: msg.linkedEntryId,
      state: "authorized",
      filledQty: 0,
      avgPrice: null,
      submitCount: 0,
      approval: msg.approval,
    };
    this.orders.set(order.clientOrderId, order);
    this.nonces.add(order.nonce);
    this.ids.add(order.clientOrderId);
    this.journal.append({
      ...blank("authorized; POST not attempted", "accept"),
      clientOrderId: order.clientOrderId,
      nonce: order.nonce,
      decisionId: order.decisionId,
      purpose: order.purpose,
      symbol: order.symbol,
      side: order.side,
      orderType: order.orderType,
      qty: order.qty,
      limitPrice: order.limitPrice,
      stopPrice: order.stopPrice,
      expiresAt: order.expiresAt,
      linkedEntryId: order.linkedEntryId,
      state: "authorized",
      filledQty: 0,
      submitCount: 0,
    });
    this.syncHermes(order, "authorized; no order submitted", null);
    return { accepted: true, reason: "validated; POST disabled; no order submitted", submitted: false };
  }

  async submit(clientOrderId: string, transport: ExecutorTransport, grant: PostEnableGrant | null, now = Date.now()): Promise<SubmitResult> {
    const order = this.orders.get(clientOrderId);
    if (!order) return { submitted: false, reason: "unknown instruction", state: null, paperTestsPassed: this.paperMockFilled };
    if (order.submitCount > 0 || order.state === "unknown" || isTerminalState(order.state) || order.state !== "authorized") {
      return { submitted: false, reason: "no blind retry; reconcile by client_order_id", state: order.state, paperTestsPassed: this.paperMockFilled };
    }
    if (this.kill && order.purpose === "ENTRY") {
      return { submitted: false, reason: "kill switch blocks new entries", state: order.state, paperTestsPassed: this.paperMockFilled };
    }
    const decision = postDecision({
      venue: "PAPER",
      transportKind: transport.kind,
      grant,
      operatorSecret: this.operatorSecret,
      now,
      paperTestsPassed: this.paperMockFilled,
    });
    if (!decision.allowed) return { submitted: false, reason: decision.reason, state: order.state, paperTestsPassed: this.paperMockFilled };
    const sigErr = this.reverify(order, now);
    if (sigErr) return { submitted: false, reason: sigErr, state: order.state, paperTestsPassed: this.paperMockFilled };

    const lookupUrl = paperLookupUrl(order.clientOrderId);
    let prior: { status: number; body: unknown };
    try {
      prior = await transport.call({ method: "GET", url: lookupUrl, headers: {} });
    } catch (error) {
      this.commit(order, "unknown", order.filledQty, order.avgPrice, "pre-submit lookup failed; not submitted", "unknown");
      return { submitted: false, reason: `lookup failed; not submitted: ${this.safe(error)}`, state: order.state, paperTestsPassed: this.paperMockFilled };
    }
    if (prior.status === 200) {
      const mapped = orderFromBroker(prior.body);
      this.commit(order, fromMachine(mapped.state), mapped.filledQty, order.avgPrice, "broker already has this client_order_id; not submitted again", statusWord(fromMachine(mapped.state)));
      return { submitted: false, reason: "broker already has this client_order_id; not submitted again", state: order.state, paperTestsPassed: this.paperMockFilled };
    }
    if (prior.status !== 404) {
      this.commit(order, "unknown", order.filledQty, order.avgPrice, "pre-submit lookup inconclusive; not submitted", "unknown");
      return { submitted: false, reason: "lookup inconclusive; not submitted", state: order.state, paperTestsPassed: this.paperMockFilled };
    }

    order.submitCount = 1;
    this.commit(order, "submitted", 0, null, "submit attempt", null);
    try {
      const response = await transport.call({ method: "POST", url: paperOrderUrl(), headers: {}, body: payload(order) });
      if (response.status < 200 || response.status >= 300) {
        this.commit(order, "rejected", 0, null, "broker rejected", "rejected");
        return { submitted: true, reason: "rejected", state: order.state, paperTestsPassed: this.paperMockFilled };
      }
      const mapped = orderFromBroker(response.body);
      this.commit(order, fromMachine(mapped.state), mapped.filledQty, order.avgPrice, "broker acknowledged", statusWord(fromMachine(mapped.state)));
      if (transport.kind === "mock") this.paperMockFilled = true;
      return { submitted: true, reason: "broker acknowledged", state: order.state, paperTestsPassed: this.paperMockFilled };
    } catch (error) {
      this.commit(order, "unknown", order.filledQty, order.avgPrice, "uncertain outcome; not retried", null);
      const recovered = await resolveUnknownOrder(transport, RECONCILE_CREDS, {
        clientOrderId: order.clientOrderId,
        brokerId: null,
        symbol: order.symbol,
        side: order.side,
        qty: order.qty,
        filledQty: order.filledQty,
        state: "unknown_pending_reconciliation",
        reason: "",
        theoretical: true,
      });
      this.commit(
        order,
        fromMachine(recovered.state),
        recovered.filledQty,
        order.avgPrice,
        this.safeMessage(recovered.reason || this.safe(error)),
        statusWord(fromMachine(recovered.state)),
      );
      if (transport.kind === "mock") this.paperMockFilled = true;
      return { submitted: false, reason: recovered.reason, state: order.state, paperTestsPassed: this.paperMockFilled };
    }
  }

  submitLive(grant: PostEnableGrant | null, now = Date.now()): SubmitResult {
    const decision = postDecision({
      venue: "LIVE",
      transportKind: "alpaca-live",
      grant,
      operatorSecret: this.operatorSecret,
      now,
      paperTestsPassed: this.paperMockFilled,
    });
    return { submitted: false, reason: decision.reason, state: null, paperTestsPassed: this.paperMockFilled };
  }

  onBroker(clientOrderId: string, status: string, filledQty: number, avgPrice: number | null = null): OrderRecord {
    const order = this.orders.get(clientOrderId);
    if (!order) throw new Error("unknown instruction");
    if (order.state === "authorized") throw new Error("not submitted");
    this.commit(order, fromMachine(mapBrokerStatus(status)), filledQty, avgPrice, `broker ${status}`, status);
    return { ...order, approval: null };
  }

  private reverify(order: OrderRecord, now: number): string | null {
    if (order.purpose === "STOP") return verifyProtectiveApproval(order.approval as ProtectiveApproval | null, this.operatorSecret, now);
    const ticket = paperTicket({
      decisionId: order.decisionId,
      clientOrderId: order.clientOrderId,
      strategyId: "replay",
      strategyVersion: "v1",
      strategyApproved: false,
      symbol: "SPY",
      side: order.side,
      orderType: "limit",
      purpose: order.purpose,
      qty: order.qty,
      limitPrice: order.limitPrice,
      stopPrice: order.stopPrice,
      session: "REGULAR",
      timeInForce: "day",
      expiresAt: order.expiresAt,
      nonce: order.nonce,
      evidenceTimestamp: new Date(now).toISOString(),
      category: "CONNECTIVITY_TEST",
      sizedNotional: order.qty * order.limitPrice,
      authorizationRef: "stored",
      linkedEntryId: order.linkedEntryId,
      approval: order.approval as OperatorApproval,
      gateProof: {
        singleUseId: order.clientOrderId,
        symbol: "SPY",
        side: order.side,
        qty: order.qty,
        limitPrice: order.limitPrice,
        computedAt: new Date(now).toISOString(),
        sigmaApproved: true,
        sentinelApproved: true,
        sigmaVeto: false,
        sentinelVeto: false,
        proof: "",
      },
    });
    return verifyOperatorApproval(ticket, order.approval as OperatorApproval | null, this.operatorSecret, now);
  }

  private commit(order: OrderRecord, state: LifecycleState, filledQty: number, avgPrice: number | null, reason: string, reconcileStatus: string | null): void {
    if (order.state !== state) order.state = nextLifecycle(order.state, state);
    order.filledQty = filledQty;
    if (avgPrice != null) order.avgPrice = avgPrice;
    this.journal.append({
      ...blank(reason, "state"),
      clientOrderId: order.clientOrderId,
      state: order.state,
      filledQty: order.filledQty,
      avgPrice: order.avgPrice,
      submitCount: order.submitCount,
      purpose: order.purpose,
      side: order.side,
      symbol: order.symbol,
    });
    this.syncHermes(order, reason, reconcileStatus);
  }

  private syncHermes(order: OrderRecord, reason: string, reconcileStatus: string | null): void {
    const nowIso = new Date().toISOString();
    if (reconcileStatus) reportReconcile(this.hermes, order, reconcileStatus, nowIso);
    else reportToHermes(this.hermes, order, nowIso, reason);
  }

  private safe(error: unknown): string {
    return redactSecrets(error instanceof Error ? error.message : "broker request failed", this.redact);
  }

  private safeMessage(message: string): string {
    return redactSecrets(message, this.redact);
  }
}

