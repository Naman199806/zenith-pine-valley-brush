export interface BotRole {
  id: string;
  name: string;
  markets: ("crypto" | "equity")[];
  mayTrade: false;
  mayChangeFlags: false;
}

export const BOTS: BotRole[] = [
  { id: "scout", name: "Scout", markets: ["crypto", "equity"], mayTrade: false, mayChangeFlags: false },
  { id: "vector", name: "Vector", markets: ["crypto", "equity"], mayTrade: false, mayChangeFlags: false },
  { id: "atlas", name: "Atlas", markets: ["equity"], mayTrade: false, mayChangeFlags: false },
  { id: "oracle", name: "Oracle", markets: ["crypto", "equity"], mayTrade: false, mayChangeFlags: false },
  { id: "pulse", name: "Pulse", markets: ["crypto", "equity"], mayTrade: false, mayChangeFlags: false },
  { id: "volta", name: "Volta", markets: ["equity"], mayTrade: false, mayChangeFlags: false },
  { id: "bull", name: "Bull", markets: ["crypto", "equity"], mayTrade: false, mayChangeFlags: false },
  { id: "bear", name: "Bear", markets: ["crypto", "equity"], mayTrade: false, mayChangeFlags: false },
  { id: "sigma", name: "Sigma", markets: ["crypto", "equity"], mayTrade: false, mayChangeFlags: false },
  { id: "sentinel", name: "Sentinel", markets: ["crypto", "equity"], mayTrade: false, mayChangeFlags: false },
  { id: "allocator", name: "Allocator", markets: ["crypto", "equity"], mayTrade: false, mayChangeFlags: false },
  { id: "pilot", name: "Pilot", markets: ["crypto", "equity"], mayTrade: false, mayChangeFlags: false },
  { id: "hermes", name: "Hermes", markets: ["crypto", "equity"], mayTrade: false, mayChangeFlags: false },
];
