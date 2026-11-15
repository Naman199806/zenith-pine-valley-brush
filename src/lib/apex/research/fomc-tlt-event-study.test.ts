import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const contaminated = JSON.parse(readFileSync("research/lab/fomc-tlt-event-study-HOLDOUT_CONTAMINATED.json", "utf8"));
const study = JSON.parse(readFileSync("research/lab/fomc-tlt-event-study.json", "utf8"));

test("previous full-sample is marked HOLDOUT_CONTAMINATED and preserved", () => {
  assert.equal(contaminated.status, "HOLDOUT_CONTAMINATED");
  assert.equal(contaminated.scheduled_eligible_independent, 195);
  assert.equal(contaminated.exposed_post_2024_events, 15);
  assert.ok(contaminated.contamination_note.includes("post-2024"));
});

test("recompute is period-bounded and documents contamination", () => {
  assert.equal(study.status, "PERIOD_BOUNDED_RECOMPUTE");
  assert.equal(study.previous_full_sample_status, "HOLDOUT_CONTAMINATED");
  assert.equal(study.contamination_details.post_2024_events_previously_examined, 15);
  assert.equal(study.contamination_details.development_events, 133);
  assert.equal(study.contamination_details.validation_events, 47);
  assert.ok(study.contamination_details.note.includes("no longer treated as sealed"));
});

test("development results use only permitted observations and CI includes zero", () => {
  const d = study.development_to_2018;
  assert.equal(d.n_event, 133);
  assert.ok(d.n_control > 200);
  assert.ok(d.ci95[0] < 0 && d.ci95[1] > 0);
  assert.ok(d.approx_p > 0.05);
  const b = study.bootstrap_development;
  assert.ok(b.boot_ci95[0] < 0 && b.boot_ci95[1] > 0);
});

test("validation results are period-bounded, non-significant, CI includes zero", () => {
  const v = study.validation_2019_2024;
  assert.equal(v.n_event, 47);
  assert.ok(v.ci95[0] < 0 && v.ci95[1] > 0);
  assert.ok(v.approx_p > 0.05);
  const b = study.bootstrap_validation;
  assert.ok(b.boot_ci95[0] < 0);
});

test("decision remains NO-GO; no further holdout access", () => {
  assert.equal(study.decision, "NO-GO");
  assert.ok(study.decision_reason.includes("non-significant"));
  assert.equal(study.no_lookahead, true);
  assert.equal(study.next_session_only, true);
});

test("script can be re-run to independently derive statistics", () => {
  // Re-run and confirm key contamination and period counts are stable
  const out = execSync("python3 scripts/fomc-tlt-event-study.py", { encoding: "utf8" });
  const parsed = JSON.parse(out);
  assert.equal(parsed.contamination.post_2024_events_previously_examined, 15);
  assert.equal(parsed.dev.n_event, 133);
  assert.equal(parsed.val.n_event, 47);
  assert.equal(parsed.decision, "NO-GO");
});
