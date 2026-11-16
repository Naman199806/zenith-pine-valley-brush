/**
 * Broker access for the executor.
 * Paper reads reuse fetchPaperEvidence / paperGet.
 * Alpaca POST is refused in the transport itself. Live POST is refused
 * by the existing read-only guard. Mock transports are a test seam.
 */

import { PAPER_TRADING_ORIGIN, assertPaperUrl, redactSecrets } from "../../../src/lib/apex/broker/allowlist.ts";
import { assertLiveReadOnly } from "../../../src/lib/apex/broker/live-readonly.ts";
import type { Transport } from "../../../src/lib/apex/broker/client.ts";
import { assertPaperCreds, paperGet, type PaperCreds } from "../../../src/lib/apex/broker/paper-read.ts";
import { fetchPaperEvidence, PAPER_EVIDENCE_URLS, type BrokerEvidence } from "../../../src/lib/apex/broker/paper-equity-transport.ts";
import type { MarketSnapshot } from "./risk.ts";
import type { TransportKind } from "./mode.ts";

export interface ExecutorTransport extends Transport {
  kind: TransportKind;
}

export interface EvidenceSource {
  kind: TransportKind | "unconfigured";
  load(now: number): Promise<MarketSnapshot>;
}

export async function readPaperSnapshot(creds: PaperCreds, now = new Date()): Promise<MarketSnapshot> {
  const err = assertPaperCreds(creds);
  if (err) throw new Error(err);
  const bodies = new Map<string, unknown>();
  let evidence: BrokerEvidence;
  try {
    evidence = await fetchPaperEvidence(
      creds,
      async (url) => {
        assertPaperUrl(url);
        const res = await fetch(url, {
          method: "GET",
          headers: {
            "APCA-API-KEY-ID": creds.keyId,
            "APCA-API-SECRET-KEY": creds.secret,
          },
        });
        const body = await res.json().catch(() => null);
        bodies.set(url, body);
        return { status: res.status, body };
      },
      now,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "paper read failed";
    throw new Error(redactSecrets(message, [creds.keyId, creds.secret]));
  }
  const openBody = bodies.get(PAPER_EVIDENCE_URLS.openOrders);
  const openOrderSymbols = Array.isArray(openBody)
    ? openBody.map((row) => String((row as { symbol?: string }).symbol ?? "")).filter((symbol) => symbol.length > 0)
    : [];
  const positionQty: Record<string, number> = {};
  for (const position of evidence.positions) positionQty[position.symbol] = position.qty;
  return { evidence, openOrderSymbols, positionQty };
}

export function createAlpacaPaperTransport(creds: PaperCreds): ExecutorTransport {
  return {
    kind: "alpaca-paper",
    async call(input) {
      if (input.method !== "GET") throw new Error("PAPER POST DISABLED");
      assertPaperUrl(input.url);
      const path = `${new URL(input.url).pathname}${new URL(input.url).search}`;
      return paperGet(creds, path);
    },
  };
}

export function createAlpacaLiveTransport(): ExecutorTransport {
  return {
    kind: "alpaca-live",
    async call(input) {
      const url = input.url || `${"https://api.alpaca.markets"}/v2/orders`;
      assertLiveReadOnly(url, input.method);
      throw new Error("LIVE credentials are not loaded");
    },
  };
}

export function paperOrderUrl(): string {
  const url = `${PAPER_TRADING_ORIGIN}/v2/orders`;
  assertPaperUrl(url);
  return url;
}

export function paperLookupUrl(clientOrderId: string): string {
  const url = `${PAPER_TRADING_ORIGIN}/v2/orders:by_client_order_id?client_order_id=${encodeURIComponent(clientOrderId)}`;
  assertPaperUrl(url);
  return url;
}
