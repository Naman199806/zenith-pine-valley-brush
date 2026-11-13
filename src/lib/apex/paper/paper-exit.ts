import { assertPaperUrl, PAPER_TRADING_ORIGIN } from "../broker/allowlist.ts";
import { exitBeforeSubmit } from "./exit.ts";

export interface PaperRequest {
  method: "POST";
  url: string;
  body: { symbol: string; qty: string; side: "sell"; type: "market"; time_in_force: "gtc"; client_order_id: string };
}

export function buildPaperExit(owned: number, writesEnabled: boolean): { request: PaperRequest; sent: boolean } {
  const intent = exitBeforeSubmit(owned);
  const url = `${PAPER_TRADING_ORIGIN}/v2/orders`;
  assertPaperUrl(url);
  const request: PaperRequest = {
    method: "POST",
    url,
    body: { symbol: "BTC/USD", qty: String(owned), side: "sell", type: "market", time_in_force: "gtc", client_order_id: intent.clientId },
  };
  return { request, sent: writesEnabled };
}
