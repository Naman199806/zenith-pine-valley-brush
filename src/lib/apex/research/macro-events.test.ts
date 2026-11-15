import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const fomc = JSON.parse(readFileSync("research/data/raw/events/fomc.json", "utf8"));
const cpi = JSON.parse(readFileSync("research/data/raw/events/cpi.json", "utf8"));
const audit = JSON.parse(readFileSync("research/lab/macro-event-audit.json", "utf8"));

test("FOMC dataset distinguishes meeting start from statement date and keeps canceled events", () => {
  assert.ok(fomc.length >= 300);
  assert.ok(fomc.some((e: any) => e.status === "CANCELED"));
  assert.ok(fomc.some((e: any) => e.status === "UNSCHEDULED"));
  const cross = fomc.find((e: any) => e.heading?.includes("January 31-February 1"));
  if (cross) {
    assert.equal(cross.meetingStart.endsWith("-01-31"), true);
    assert.equal(cross.statementDate.endsWith("-02-01"), true);
  }
});

test("CPI releases have Eastern 08:30 times and UTC conversion", () => {
  const dated = cpi.filter((e: any) => e.statementDate);
  assert.ok(dated.length >= 200);
  assert.ok(dated.every((e: any) => e.statementTimeEt === "08:30 AM"));
  assert.ok(dated.every((e: any) => e.statementTimeUtc?.endsWith("Z")));
  assert.equal(dated[0].originalValueStatus, "NOT_RETRIEVED");
});

test("next-session lookup does not use the event-day close as a fill", () => {
  const dates = ["2024-03-20", "2024-03-21"];
  const event = "2024-03-20";
  const next = dates.find((d) => d > event);
  assert.equal(next, "2024-03-21");
  assert.notEqual(next, event);
});

test("coverage numbers match the audit for next-session eligibility", () => {
  assert.equal(audit.fomc.coverageNextSession.eligibleAll3, 303);
  assert.equal(audit.cpi.coverageNextSession.eligibleAll3, 226);
  assert.equal(audit.verdict, "TESTABLE_NEXT_SESSION");
  assert.equal(audit.backtesterTemporal.status, "NO_MISALIGNMENT_FOUND");
});

test("UTC conversion respects DST for sample dates", () => {
  const jan = fomc.find((e: any) => e.statementDate === "2026-01-28");
  const mar = fomc.find((e: any) => e.statementDate === "2026-03-18");
  if (jan) assert.equal(jan.statementTimeUtc, "2026-01-28T19:00:00.000Z");
  if (mar) assert.equal(mar.statementTimeUtc, "2026-03-18T18:00:00.000Z");
});
