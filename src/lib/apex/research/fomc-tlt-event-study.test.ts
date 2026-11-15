import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const study = JSON.parse(readFileSync("research/lab/fomc-tlt-event-study.json", "utf8"));

test("independent scheduled-only eligible count", () => {
  assert.equal(study.scheduled_eligible_independent, 195);
  assert.ok(study.hypothesis.toLowerCase().includes("absolute next-session"));
});

test("full sample shows small positive difference with CI including zero", () => {
  const f = study.full;
  assert.equal(f.n_event, 195);
  assert.ok(f.n_control > 300);
  assert.ok(f.diff_means > 0);
  assert.ok(f.ci95[0] < 0 && f.ci95[1] > 0);
  assert.ok(f.approx_p > 0.05);
  assert.ok(Math.abs(f.cohens_d) < 0.3);
});

test("validation does not reverse sign and remains non-significant", () => {
  const v = study.validation_2019_2024;
  assert.ok(v.diff_means > 0);
  assert.ok(v.ci95[0] < 0);
  assert.ok(v.approx_p > 0.05);
});

test("bootstrap CI includes zero; no lookahead flags", () => {
  assert.ok(study.bootstrap_full.boot_ci95[0] < 0);
  assert.equal(study.no_lookahead, true);
  assert.equal(study.next_session_only, true);
  assert.ok(study.sealed_holdout_preserved.includes("post-2024"));
});

test("time status recorded separately; convention not treated as verified", () => {
  assert.equal(study.time_status.UNVERIFIED + study.time_status["CONVENTION_2PM_ET_NOT_PAGE_VERIFIED"], 195);
  assert.equal(study.time_status["SCHEDULE_TIME"] || 0, 0);
});
