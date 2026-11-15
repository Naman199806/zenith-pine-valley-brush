#!/usr/bin/env python3
"""Period-bounded scheduled FOMC next-session absolute OC return study on TLT.
Hypothesis (unchanged): abs next-session TLT OC return differs between
scheduled FOMC events and matched non-event sessions within the same period.
Development: nextSession <= 2018-12-31
Validation: 2018-12-31 < nextSession <= 2024-12-31
Post-2024 observations were previously examined and are HOLDOUT_CONTAMINATED.
No further holdout access. No optimization. Next-session open/close only.
"""
import json
import statistics
import math
import random
from datetime import datetime
from collections import Counter

DEV_END = "2018-12-31"
VAL_END = "2024-12-31"

def load_tlt(path="research/data/raw/yahoo/20261112/TLT.json"):
    with open(path) as f:
        raw = json.load(f)
    bars = raw["bars"] if isinstance(raw, dict) else raw
    tlt = {}
    for b in bars:
        d = b["date"][:10]
        tlt[d] = {"open": float(b["open"]), "close": float(b["close"])}
    return tlt, sorted(tlt.keys())

def load_fomc(path="research/data/raw/events/fomc.json"):
    with open(path) as f:
        return json.load(f)

def abs_oc(tlt, d):
    b = tlt.get(d)
    if not b or b["open"] <= 0:
        return None
    return abs(b["close"] - b["open"]) / b["open"]

def prior_vol(tlt, tlt_dates, date_to_idx, d, w=20):
    idx = date_to_idx.get(d)
    if idx is None or idx < w:
        return None
    vals = [abs_oc(tlt, tlt_dates[i]) for i in range(idx - w, idx)]
    vals = [v for v in vals if v is not None]
    return statistics.median(vals) if vals else None

def is_clean(d, event_next_in_period, buf=3):
    if d in event_next_in_period:
        return False
    dt = datetime.fromisoformat(d)
    for ed in event_next_in_period:
        if abs((dt - datetime.fromisoformat(ed)).days) <= buf:
            return False
    return True

def match_controls(ev_list, period_sessions, tlt, tlt_dates, date_to_idx, event_next_in_period, k=2):
    used = set()
    ctrls = []
    for e in ev_list:
        if e["prior_vol"] is None:
            continue
        cands = []
        for s in period_sessions:
            if s["date"] in used or not is_clean(s["date"], event_next_in_period):
                continue
            if s["dow"] != e["dow"]:
                continue
            if abs(int(s["date"][:4]) - e["year"]) > 1:
                continue
            pv = prior_vol(tlt, tlt_dates, date_to_idx, s["date"])
            if pv is None:
                continue
            if abs(pv - e["prior_vol"]) / (e["prior_vol"] + 1e-9) > 0.75:
                continue
            cands.append((s, abs(pv - e["prior_vol"])))
        cands.sort(key=lambda x: x[1])
        for s, _ in cands[:k]:
            ctrls.append(s)
            used.add(s["date"])
    return ctrls

def stats(evs, ctrls):
    if len(evs) < 5 or len(ctrls) < 5:
        return {"n_event": len(evs), "n_control": len(ctrls), "insufficient": True}
    er = [e["abs_ret"] for e in evs]
    cr = [c["abs_ret"] for c in ctrls]
    me, mc = statistics.mean(er), statistics.mean(cr)
    diff = me - mc
    ve = statistics.variance(er) if len(er) > 1 else 0
    vc = statistics.variance(cr) if len(cr) > 1 else 0
    se = math.sqrt(ve / len(er) + vc / len(cr)) if (ve or vc) else 0
    ci = [diff - 1.96 * se, diff + 1.96 * se]
    psd = math.sqrt(((len(er) - 1) * ve + (len(cr) - 1) * vc) / (len(er) + len(cr) - 2)) if len(er) + len(cr) > 2 else 1
    d = diff / psd if psd else 0
    z = diff / se if se else 0
    p = 2 * (1 - 0.5 * (1 + math.erf(abs(z) / math.sqrt(2))))
    return {
        "n_event": len(evs),
        "n_control": len(ctrls),
        "mean_event": me,
        "mean_control": mc,
        "median_event": statistics.median(er),
        "median_control": statistics.median(cr),
        "diff_means": diff,
        "ci95": ci,
        "cohens_d": d,
        "approx_p": p,
    }

def bootstrap_diff(evs, ctrls, n=1000, seed=42):
    er = [e["abs_ret"] for e in evs]
    cr = [c["abs_ret"] for c in ctrls]
    if not er or not cr:
        return {"insufficient": True}
    diffs = []
    rng = random.Random(seed)
    for _ in range(n):
        es = [rng.choice(er) for _ in er]
        cs = [rng.choice(cr) for _ in cr]
        diffs.append(statistics.mean(es) - statistics.mean(cs))
    diffs.sort()
    return {
        "boot_mean": statistics.mean(diffs),
        "boot_ci95": [diffs[int(0.025 * n)], diffs[int(0.975 * n)]],
    }

def main():
    tlt, tlt_dates = load_tlt()
    fomc = load_fomc()
    inception = tlt_dates[0]
    date_to_idx = {d: i for i, d in enumerate(tlt_dates)}

    all_events = []
    for e in fomc:
        if e.get("status") != "SCHEDULED":
            continue
        sd = e.get("statementDate")
        if not sd or "undefined" in sd or sd < inception:
            continue
        nexts = [d for d in tlt_dates if d > sd]
        if not nexts:
            continue
        ns = nexts[0]
        r = abs_oc(tlt, ns)
        if r is None:
            continue
        all_events.append({
            "statementDate": sd,
            "nextSession": ns,
            "abs_ret": r,
            "dow": datetime.fromisoformat(ns).weekday(),
            "year": int(sd[:4]),
            "timeStatus": e.get("timeStatus"),
            "prior_vol": prior_vol(tlt, tlt_dates, date_to_idx, ns),
        })

    dev_events = [e for e in all_events if e["nextSession"] <= DEV_END]
    val_events = [e for e in all_events if DEV_END < e["nextSession"] <= VAL_END]
    post_events = [e for e in all_events if e["nextSession"] > VAL_END]

    def period_sessions(start_excl, end_incl):
        return [
            {"date": d, "abs_ret": abs_oc(tlt, d), "dow": datetime.fromisoformat(d).weekday()}
            for d in tlt_dates
            if (start_excl is None or d > start_excl) and d <= end_incl and abs_oc(tlt, d) is not None
        ]

    # Development sessions: from inception through DEV_END
    dev_sess = period_sessions(None, DEV_END)
    # Validation sessions: strictly after DEV_END through VAL_END
    val_sess = period_sessions(DEV_END, VAL_END)

    dev_event_next = {e["nextSession"] for e in dev_events}
    val_event_next = {e["nextSession"] for e in val_events}

    dev_ctrls = match_controls(dev_events, dev_sess, tlt, tlt_dates, date_to_idx, dev_event_next)
    val_ctrls = match_controls(val_events, val_sess, tlt, tlt_dates, date_to_idx, val_event_next)

    # Verify controls stay inside their periods
    assert all(c["date"] <= DEV_END for c in dev_ctrls)
    assert all(DEV_END < c["date"] <= VAL_END for c in val_ctrls)

    out = {
        "baseline": "0f173587",
        "status": "PERIOD_BOUNDED_RECOMPUTE",
        "previous_full_sample_status": "HOLDOUT_CONTAMINATED",
        "contamination_details": {
            "previous_full_sample_events": 195,
            "development_events": len(dev_events),
            "validation_events": len(val_events),
            "post_2024_events_previously_examined": len(post_events),
            "note": "Original full-sample and bootstrap included 15 post-2024 observations. Control matching previously used sessions outside the evaluation period. Those observations are no longer treated as sealed. This recompute uses only period-bounded events and controls. No further holdout access.",
        },
        "hypothesis": "Absolute next-session TLT open-to-close return differs between scheduled FOMC events and matched non-event sessions within the same chronological period",
        "development_to_2018": stats(dev_events, dev_ctrls),
        "validation_2019_2024": stats(val_events, val_ctrls),
        "bootstrap_development": bootstrap_diff(dev_events, dev_ctrls),
        "bootstrap_validation": bootstrap_diff(val_events, val_ctrls),
        "time_status_development": dict(Counter(e["timeStatus"] for e in dev_events)),
        "time_status_validation": dict(Counter(e["timeStatus"] for e in val_events)),
        "matching": "Within-period only. DOW match, year +/-1, prior-20d median abs-ret within 75%, exclude event next and +/-3d buffer inside the period.",
        "no_lookahead": True,
        "next_session_only": True,
        "decision": "NO-GO",
        "decision_reason": "Period-bounded results remain non-significant with CIs including zero. No independent evidence justifies reconsideration.",
    }

    with open("research/lab/fomc-tlt-event-study.json", "w") as f:
        json.dump(out, f, indent=2)

    print(json.dumps({
        "dev": out["development_to_2018"],
        "val": out["validation_2019_2024"],
        "boot_dev": out["bootstrap_development"],
        "boot_val": out["bootstrap_validation"],
        "contamination": out["contamination_details"],
        "decision": out["decision"],
    }, indent=2))
    return out

if __name__ == "__main__":
    main()
