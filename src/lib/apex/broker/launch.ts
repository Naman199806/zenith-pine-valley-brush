export type LaunchMode = "MONITORING" | "PAPER_MANUAL" | "PAPER_AUTO";

export interface LaunchFacts {
  safetyPassed: boolean;
  paperAccountConfirmed: boolean;
  reconciliationClean: boolean;
  operatorApprovedAuto: boolean;
}

export function promoteLaunch(current: LaunchMode, to: string, facts: LaunchFacts): { ok: boolean; mode: LaunchMode; reasons: string[] } {
  if (to === "LIVE" || to === "LIVE_ELIGIBLE" || to === "SHADOW") {
    return { ok: false, mode: current, reasons: ["Live trading is not implemented and cannot be selected."] };
  }
  if (to !== "MONITORING" && to !== "PAPER_MANUAL" && to !== "PAPER_AUTO") {
    return { ok: false, mode: current, reasons: ["Unknown launch mode."] };
  }
  if (to === "MONITORING") return { ok: true, mode: "MONITORING", reasons: [] };
  if (to === "PAPER_MANUAL") {
    const reasons: string[] = [];
    if (!facts.safetyPassed) reasons.push("Safety checks have not passed.");
    if (!facts.paperAccountConfirmed) reasons.push("The paper account has not been confirmed with an authenticated request.");
    if (reasons.length) return { ok: false, mode: current, reasons };
    return { ok: true, mode: "PAPER_MANUAL", reasons: [] };
  }
  const reasons: string[] = [];
  if (current !== "PAPER_MANUAL" && current !== "PAPER_AUTO") reasons.push("Paper auto requires paper manual first.");
  if (!facts.paperAccountConfirmed) reasons.push("The paper account has not been confirmed.");
  if (!facts.reconciliationClean) reasons.push("Broker reconciliation has not succeeded.");
  if (!facts.operatorApprovedAuto) reasons.push("Paper auto needs an explicit operator approval.");
  if (reasons.length) return { ok: false, mode: current, reasons };
  return { ok: true, mode: "PAPER_AUTO", reasons: [] };
}

export function maySubmit(mode: LaunchMode, operatorConfirmed: boolean, autoApproved: boolean): string | null {
  if (mode === "MONITORING") return "Monitoring does not send broker orders.";
  if (mode === "PAPER_MANUAL" && !operatorConfirmed) return "The operator has not confirmed this paper order.";
  if (mode === "PAPER_AUTO" && !autoApproved) return "Paper auto is not approved.";
  return null;
}
