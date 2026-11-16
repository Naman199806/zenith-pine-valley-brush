/**
 * Exact SPY PAPER LIMIT ticket for the next regular session.
 * Not authorized. Not submitted. Quote must be fresh at decision time.
 */

import { randomUUID } from "node:crypto";

export interface ExactSpyTicket {
  status: "PREPARED_NOT_AUTHORIZED";
  host: "paper-api.alpaca.markets";
  symbol: "SPY";
  side: "buy" | "sell";
  orderType: "limit";
  timeInForce: "day";
  session: "REGULAR";
  sessionWindow: string;
  qty: number | null;
  limitPrice: number | null;
  maxEntryNotional: 25;
  clientOrderId: string;
  expiresAt: string;
  operatorAuthorized: false;
  quote: "REQUIRED_AT_AUTHORIZATION";
  submitted: false;
}

export function nextRegularSession(now = new Date()): { window: string; expiresAt: string } {
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = et.getDay();
  const afterClose = et.getHours() > 16 || (et.getHours() === 16 && et.getMinutes() >= 0);
  const add = day === 0 ? 1 : day === 6 ? 2 : afterClose || day === 5 && afterClose ? (8 - day) % 7 || 3 : 0;
  const session = new Date(et);
  session.setDate(et.getDate() + (et.getHours() >= 16 || day === 0 || day === 6 ? add || 1 : 0));
  if (session.getDay() === 0) session.setDate(session.getDate() + 1);
  if (session.getDay() === 6) session.setDate(session.getDate() + 2);
  const y = session.getFullYear();
  const m = String(session.getMonth() + 1).padStart(2, "0");
  const d = String(session.getDate()).padStart(2, "0");
  return { window: `${y}-${m}-${d} 09:30-16:00 ET`, expiresAt: `${y}-${m}-${d}T16:00:00-05:00` };
}

export function prepareExactSpyBuy(now = new Date()): ExactSpyTicket {
  const session = nextRegularSession(now);
  return {
    status: "PREPARED_NOT_AUTHORIZED",
    host: "paper-api.alpaca.markets",
    symbol: "SPY",
    side: "buy",
    orderType: "limit",
    timeInForce: "day",
    session: "REGULAR",
    sessionWindow: session.window,
    qty: null,
    limitPrice: null,
    maxEntryNotional: 25,
    clientOrderId: `apex-spy-${randomUUID()}`,
    expiresAt: session.expiresAt,
    operatorAuthorized: false,
    quote: "REQUIRED_AT_AUTHORIZATION",
    submitted: false,
  };
}

export function authorizationMatches(auth: { symbol: string; side: string; qty: number; limitPrice: number; session: string; expiresAt: string }, ticket: ExactSpyTicket): boolean {
  return auth.symbol === ticket.symbol && auth.side === ticket.side && auth.session === ticket.session && auth.expiresAt === ticket.expiresAt && auth.qty * auth.limitPrice * 1.001 <= ticket.maxEntryNotional;
}
