/** Operator-facing status. Detail and checksums live in the manifest. */
export const HISTORY_STATUS = {
  provider: "yahoo-chart-v8",
  fetchedUtc: "2026-11-12T04:05:31Z",
  manifest: "research/data/manifests/yahoo-20261112.json",
  secondSource: "BLOCKED" as const,
  adjustedCloseIsPointInTime: false as const,
  symbols: ["SPY", "QQQ", "IWM", "GLD", "TLT", "BIL"] as const,
};
