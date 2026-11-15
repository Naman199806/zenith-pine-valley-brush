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

test("corrected per-instrument eligibility and intersection", () => {
  assert.equal(audit.FOMC.eligible_SPY, 303);
  assert.equal(audit.FOMC.eligible_QQQ, 252);
  assert.equal(audit.FOMC.eligible_TLT, 220);
  assert.equal(audit.FOMC.eligible_all_three, 220);
  assert.equal(audit.CPI.eligible_all_three, 226);
  assert.equal(audit.verdict, "TESTABLE_NEXT_SESSION");
});

test("1995-02-01 FOMC is eligible for SPY only", () => {
  const sample = audit.FOMC.sample_1995_02_01;
  assert.equal(sample.statementDate, "1995-02-01");
  assert.equal(sample.eligible.SPY, true);
  assert.equal(sample.eligible.QQQ, false);
  assert.equal(sample.eligible.TLT, false);
});

test("event cannot be eligible before instrument first bar", () => {
  const first = audit.instrumentInception;
  assert.equal(first.SPY, "1993-01-29");
  assert.equal(first.QQQ, "1999-03-10");
  assert.equal(first.TLT, "2002-07-30");
  // pre-inception counts match
  assert.equal(audit.FOMC.exclusions.pre_inception_QQQ, 51);
  assert.equal(audit.FOMC.exclusions.pre_inception_TLT, 83);
  assert.equal(audit.FOMC.exclusions.pre_inception_SPY, 0);
});

test("DATE_VERIFIED is separate from TIME_VERIFIED; convention is not proof", () => {
  assert.ok(audit.FOMC.date_verified >= 300);
  assert.equal(audit.FOMC.time_verified, 0);
  assert.equal(audit.FOMC.time_convention_only, 48);
  assert.ok(audit.FOMC.time_unverified > 200);
  assert.equal(audit.CPI.time_verified, 227);
  assert.ok(audit.methodology.includes("Conventional 2PM ET is NOT proof"));
});

test("UTC conversion respects DST for sample dates", () => {
  const jan = fomc.find((e: any) => e.statementDate === "2026-01-28");
  const mar = fomc.find((e: any) => e.statementDate === "2026-03-18");
  if (jan) assert.equal(jan.statementTimeUtc, "2026-01-28T19:00:00.000Z");
  if (mar) assert.equal(mar.statementTimeUtc, "2026-03-18T18:00:00.000Z");
});
