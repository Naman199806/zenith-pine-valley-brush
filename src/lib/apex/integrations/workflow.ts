/**
 * End-to-end research demonstration through Apex contracts.
 * Invokes adapters, runs the risk gate, and refuses any order path.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { leanBacktest, backtraderVerify, freqtradeResearch, tradingAgentsEvidence, dayTraderCandidate, hermesExperiment } from "./adapters.ts";
import { assessProposal, paperAutoEligible } from "./gate.ts";

export function runUnifiedWorkflow() {
  const lean = leanBacktest();
  const backtrader = backtraderVerify();
  const freqtrade = freqtradeResearch();
  const agents = tradingAgentsEvidence();
  const dayTrader = dayTraderCandidate();
  const hermes = hermesExperiment();
  const proposal = agents?.proposal ?? null;
  const assessment = proposal ? assessProposal(proposal) : null;
  const auto = proposal ? paperAutoEligible(proposal) : false;
  const result = {
    schemaVersion: "apex.workflow.v1" as const,
    generatedAt: new Date().toISOString(),
    executable: false as const,
    paperAutoEligible: auto,
    liveEnabled: false as const,
    adapters: {
      lean: lean ? "invoked" : "missing",
      backtrader: backtrader ? "invoked" : "missing",
      freqtrade: freqtrade ? "invoked" : "missing",
      tradingagents: agents ? "invoked" : "missing",
      dayTrader: dayTrader ? "invoked" : "missing",
      hermes: hermes ? "invoked" : "missing",
    },
    proposalAccepted: assessment?.accepted ?? false,
    proposalReasons: assessment?.reasons ?? [],
    hermesCanApprove: false as const,
    alpacaIsSoleBroker: true as const,
  };
  const dir = join(process.cwd(), "research", "workflow");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "adapters.json"), JSON.stringify(result, null, 2));
  return result;
}
