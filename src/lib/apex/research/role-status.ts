export type RoleStatus = "REAL_MODEL" | "RULE_BASED" | "FIXTURE" | "IDLE" | "UNAVAILABLE" | "ERROR";

export interface RoleRecord {
  id: string;
  name: string;
  status: RoleStatus;
  mechanism: string;
  modelCall: boolean;
  sources: string[];
  consumed: boolean;
  note: string;
}

export const ROLE_STATUS: RoleRecord[] = [
  { id: "scanner", name: "Market scanner", status: "RULE_BASED", mechanism: "local manifests", modelCall: false, sources: ["yahoo", "coinbase"], consumed: true, note: "Lists known symbols only." },
  { id: "technical", name: "Technical analyst", status: "RULE_BASED", mechanism: "completed bars", modelCall: false, sources: ["yahoo", "coinbase"], consumed: true, note: "Completed bars only." },
  { id: "fundamental", name: "Fundamental analyst", status: "UNAVAILABLE", mechanism: "none", modelCall: false, sources: [], consumed: false, note: "SEC EDGAR is not connected." },
  { id: "macro", name: "Macro analyst", status: "UNAVAILABLE", mechanism: "none", modelCall: false, sources: [], consumed: false, note: "FRED is not connected." },
  { id: "news", name: "News and sentiment", status: "UNAVAILABLE", mechanism: "none", modelCall: false, sources: [], consumed: false, note: "No authorized news API." },
  { id: "derivatives", name: "Derivatives analyst", status: "UNAVAILABLE", mechanism: "none", modelCall: false, sources: [], consumed: false, note: "No options chain." },
  { id: "bull", name: "Bull researcher", status: "REAL_MODEL", mechanism: "infer()", modelCall: true, sources: ["completed bars"], consumed: true, note: "Calls the model if a key is present. Otherwise MODEL_UNAVAILABLE." },
  { id: "bear", name: "Bear researcher", status: "REAL_MODEL", mechanism: "infer()", modelCall: true, sources: ["completed bars"], consumed: true, note: "Independent of the bull call." },
  { id: "quant", name: "Quantitative validator", status: "RULE_BASED", mechanism: "registry", modelCall: false, sources: ["baselines"], consumed: true, note: "Can reject. Cannot promote on a model note." },
  { id: "pm", name: "Portfolio manager", status: "RULE_BASED", mechanism: "sizing", modelCall: false, sources: ["risk constants"], consumed: true, note: "Sizes only." },
  { id: "risk", name: "Risk officer", status: "RULE_BASED", mechanism: "evaluateRisk", modelCall: false, sources: ["risk engine"], consumed: true, note: "Cannot be overridden by a model." },
  { id: "execution", name: "Execution planner", status: "RULE_BASED", mechanism: "proposal only", modelCall: false, sources: [], consumed: false, note: "No broker tool." },
];
