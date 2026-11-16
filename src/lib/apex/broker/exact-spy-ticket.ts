/**
 * Exact SPY PAPER LIMIT ticket.
 * Session comes from verified Alpaca calendar evidence, not local date arithmetic.
 * Authorization must match the finalized ticket exactly. Unset values are rejected.
 * Not submitted.
 */

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

export interface CalendarDay {
  date: string;
  open: string;
  close: string;
}

export interface ExactSpyTicket {
  status: "PREPARED_NOT_AUTHORIZED" | "AWAITING_REGULAR_QUOTE";
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

export interface Authorization {
  symbol: string;
  side: "buy" | "sell";
  orderType: "limit";
  timeInForce: "day";
  qty: number;
  limitPrice: number;
  clientOrderId: string;
  session: "REGULAR";
  expiresAt: string;
}

export function loadVerifiedCalendar(path = "research/fixtures/paper/calendar-verified.json"): CalendarDay[] {
  const doc = JSON.parse(readFileSync(path, "utf8"));
  return doc.days as CalendarDay[];
}

function etParts(now: Date): { date: string; minutes: number; offset: string } {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  const utc = new Date(now.toLocaleString("en-US", { timeZone: "UTC" }));
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const offsetMin = Math.round((utc.getTime() - et.getTime()) / 60000);
  const sign = offsetMin >= 0 ? "-" : "+";
  const abs = Math.abs(offsetMin);
  const offset = `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
  return { date, minutes, offset };
}

export function nextRegularSession(now: Date, calendar: CalendarDay[]): { window: string; expiresAt: string; date: string; close: string } {
  const { date, minutes, offset } = etParts(now);
  const upcoming = calendar.filter((d) => d.date > date || (d.date === date && minutes < toMinutes(d.close))).sort((a, b) => a.date.localeCompare(b.date));
  const day = upcoming[0];
  if (!day) throw new Error("no verified calendar session");
  const close = day.close;
  return {
    date: day.date,
    close,
    window: `${day.date} ${day.open}-${close} ET`,
    expiresAt: `${day.date}T${close}:00${offsetFor(day.date)}`,
  };
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h! * 60 + m!;
}

function offsetFor(date: string): string {
  const utc = new Date(`${date}T16:00:00Z`);
  const et = new Date(utc.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const ref = new Date(utc.toLocaleString("en-US", { timeZone: "UTC" }));
  const offsetMin = Math.round((ref.getTime() - et.getTime()) / 60000);
  const sign = offsetMin >= 0 ? "-" : "+";
  const abs = Math.abs(offsetMin);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:00`;
}

export function prepareExactSpyBuy(now: Date, calendar: CalendarDay[], clientOrderId = `apex-spy-${randomUUID()}`): ExactSpyTicket {
  const session = nextRegularSession(now, calendar);
  return {
    status: "AWAITING_REGULAR_QUOTE",
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
    clientOrderId,
    expiresAt: session.expiresAt,
    operatorAuthorized: false,
    quote: "REQUIRED_AT_AUTHORIZATION",
    submitted: false,
  };
}

export function authorizationMatches(auth: Authorization, ticket: ExactSpyTicket): boolean {
  if (ticket.qty == null || ticket.limitPrice == null) return false;
  if (!(auth.qty > 0) || !Number.isFinite(auth.qty)) return false;
  if (!(auth.limitPrice > 0) || !Number.isFinite(auth.limitPrice)) return false;
  return auth.symbol === ticket.symbol
    && auth.side === ticket.side
    && auth.orderType === ticket.orderType
    && auth.timeInForce === ticket.timeInForce
    && auth.qty === ticket.qty
    && auth.limitPrice === ticket.limitPrice
    && auth.clientOrderId === ticket.clientOrderId
    && auth.session === ticket.session
    && auth.expiresAt === ticket.expiresAt
    && auth.qty * auth.limitPrice * 1.001 <= ticket.maxEntryNotional;
}

export function entitledToDividend(entryDate: string, exDate: string): boolean {
  return entryDate < exDate;
}
