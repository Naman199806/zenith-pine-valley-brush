/**
 * Real Trading API writes are unreachable in this build.
 * REAL_BROKER_WRITE_ENABLED is a constant false. Write methods throw before
 * fetch. Tests inject a fake writer. No environment variable can flip this.
 */

export const REAL_BROKER_WRITE_ENABLED = false;

export function assertRealBrokerWriteDisabled(method: string): void {
  const upper = method.toUpperCase();
  if (upper === "GET" || upper === "HEAD") return;
  if (!REAL_BROKER_WRITE_ENABLED) throw new Error("PAPER POST DISABLED");
  throw new Error("PAPER POST DISABLED");
}

export class ProcessCrash extends Error {
  constructor() {
    super("process crash");
    this.name = "ProcessCrash";
  }
}

export type WriteResult =
  | { kind: "ack"; status: number; body: Record<string, unknown> }
  | { kind: "rejected"; status: number; body: unknown }
  | { kind: "ambiguous"; reason: string }
  | { kind: "rate_limit" }
  | { kind: "unavailable"; status: number };

export interface PaperWriter {
  readonly networkWrite: "disabled" | "injected";
  submit(order: object): Promise<WriteResult>;
  cancel(clientOrderId: string): Promise<WriteResult>;
  getOrder(clientOrderId: string): Promise<{ status: number; body: unknown }>;
  getPositions(): Promise<{ status: number; body: unknown }>;
  getOpenOrders(): Promise<{ status: number; body: unknown }>;
}

/**
 * Production write adapter. submit and cancel throw before fetch.
 * Reads throw without calling fetch as well: this build has no real writer,
 * and recovery tests pass an injected writer.
 */
export function createDisabledPaperWriter(fetchImpl: typeof fetch = fetch): PaperWriter {
  const refuse = async (method: "POST" | "DELETE"): Promise<never> => {
    assertRealBrokerWriteDisabled(method);
    await fetchImpl("https://paper-api.alpaca.markets/v2/orders", { method });
    throw new Error("unreachable");
  };
  return {
    networkWrite: "disabled",
    submit() {
      return refuse("POST");
    },
    cancel() {
      return refuse("DELETE");
    },
    async getOrder() {
      throw new Error("REAL_BROKER_WRITE_DISABLED");
    },
    async getPositions() {
      throw new Error("REAL_BROKER_WRITE_DISABLED");
    },
    async getOpenOrders() {
      throw new Error("REAL_BROKER_WRITE_DISABLED");
    },
  };
}
