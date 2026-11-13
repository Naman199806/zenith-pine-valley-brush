import type { BrokerOrder } from "./client.ts";
import type { LaunchMode } from "./launch.ts";
import type { OrbSignal } from "./orb.ts";

export interface PaperAccountView {
  equity: string;
  cash: string;
  buyingPower: string;
  status: string;
  blocked: boolean;
}

export interface PaperPositionView {
  symbol: string;
  qty: string;
  avgEntry: string;
  unrealizedPl: string;
  marketValue: string;
}

export interface PaperDeskView {
  launchMode: LaunchMode;
  liveSelectable: false;
  connected: boolean;
  keysStored: boolean;
  paperAccountConfirmed: boolean;
  reason: string;
  host: "paper-api.alpaca.markets";
  dataFeed: "iex" | "unavailable";
  dataNote: string;
  streamNote: string;
  clock: { timestamp: string; isOpen: boolean } | null;
  lastDataTs: string | null;
  account: PaperAccountView | null;
  positions: PaperPositionView[];
  orders: BrokerOrder[];
  signals: OrbSignal[];
  riskNotes: string[];
  events: { ts: string; text: string }[];
  reconciliationClean: boolean;
  reconciliationNotes: string[];
  emergency: boolean;
  safetyPassed: boolean;
  safetyFailed: string[];
  dayDrawdown: number | null;
  minuteEt: number | null;
  proposal: PaperProposal | null;
}

export interface PaperProposal {
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  clientOrderId: string;
  entryPriceCents: number;
  stopPriceCents: number;
  notionalCents: number;
  cashCents: number;
  marketOpen: boolean;
  eligible: boolean;
  reasons: string[];
}
