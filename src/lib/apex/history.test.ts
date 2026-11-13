import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { sha256Hex, verifyChecksum } from "./history/manifest.ts";
import {
  accountingUsesAdjustedClose,
  badSplits,
  barIssues,
  dividendsMissingEx,
  duplicateDates,
  missingSessions,
  revisedAdjustedClose,
} from "./history/validate.ts";

describe("history integrity", () => {
  it("verifies a checksum and rejects a different body", () => {
    const body = "{\"symbol\":\"SPY\"}";
    const digest = sha256Hex(body);
    assert.equal(digest.length, 64);
    assert.equal(verifyChecksum(body, digest), true);
    assert.equal(verifyChecksum(body + " ", digest), false);
  });

  it("flags duplicate dates, bad prices, and impossible bars", () => {
    const issues = barIssues([
      { date: "2024-01-02", exchangeTs: "2024-01-02T14:30:00Z", open: 10, high: 11, low: 9, close: 10, volume: 1, yahooAdjClose: 8 },
      { date: "2024-01-02", exchangeTs: "2024-01-02T14:30:00Z", open: 10, high: 11, low: 9, close: 10, volume: 1, yahooAdjClose: 8 },
      { date: "2024-01-03", exchangeTs: "2024-01-03T14:30:00Z", open: 0, high: 1, low: 1, close: 1, volume: -1, yahooAdjClose: null },
    ]);
    assert.ok(issues.some((issue) => issue.reason.includes("duplicate date")));
    assert.ok(issues.some((issue) => issue.reason.includes("non-positive price")));
    assert.deepEqual(duplicateDates(["2024-01-02", "2024-01-02"]), ["2024-01-02"]);
  });

  it("flags a dividend without an ex-timestamp and a split with a bad ratio", () => {
    assert.equal(dividendsMissingEx([{ exDate: null, exTs: null, amount: 1 }]), 1);
    assert.equal(dividendsMissingEx([{ exDate: "2024-06-15", exTs: "2024-06-15T13:30:00Z", amount: 1 }]), 0);
    const reasons = badSplits([{ exDate: null, exTs: null, numerator: 2, denominator: 0 }]);
    assert.ok(reasons.includes("split missing ex-timestamp"));
    assert.ok(reasons.includes("split ratio not positive"));
  });

  it("flags a missing session and a revised adjusted close", () => {
    assert.deepEqual(missingSessions(["2024-01-02", "2024-01-03"], ["2024-01-02"]), ["2024-01-03"]);
    assert.deepEqual(
      revisedAdjustedClose([{ date: "2024-01-02", adj: 10 }], [{ date: "2024-01-02", adj: 9 }]),
      ["2024-01-02"],
    );
    assert.equal(accountingUsesAdjustedClose(100, 80, 80), true);
    assert.equal(accountingUsesAdjustedClose(100, 80, 100), false);
  });

  it("matches the stored SPY snapshot and records a blocked second source", () => {
    const manifest = JSON.parse(readFileSync("research/data/manifests/yahoo-20261112.json", "utf8"));
    const spy = manifest.files.find((file: { symbol: string }) => file.symbol === "SPY");
    const body = readFileSync(spy.path);
    assert.equal(verifyChecksum(body.toString(), spy.sha256), true);
    assert.equal(manifest.secondSource.status, "BLOCKED");
    assert.equal(manifest.adjustedCloseIsPointInTime, false);
    assert.equal(manifest.utcVersusNewYorkDateMismatches, 0);
    assert.equal(spy.bars, 8505);
  });
});
