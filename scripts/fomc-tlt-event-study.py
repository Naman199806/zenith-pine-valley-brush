#!/usr/bin/env python3
"""Independent scheduled FOMC next-session absolute OC return study on TLT.
Hypothesis frozen before calculation: abs next-session TLT OC return differs
between scheduled FOMC and matched non-event sessions.
No strategy. Next-session open/close only. No lookahead.
"""
import json
import statistics
import math
import random
from datetime import datetime
from collections import Counter

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

def main():
    tlt, tlt_dates = load_tlt()
    fomc = load_fomc()
    inception = tlt_dates[0]
    date_to_idx = {d: i for i, d in enumerate(tlt_dates)}
    events = []
    event_next = set()
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
        events.append({
            "statementDate": sd,
            "nextSession": ns,
            "abs_ret": r,
            "dow": datetime.fromisoformat(ns).weekday(),
            "year": int(sd[:4]),
            "timeStatus": e.get("timeStatus"),
        })
        event_next.add(ns)
    # prior vol
    def prior_vol(d, w=20):
        idx = date_to_idx.get(d)
        if idx is None or idx < w:
            return None
        vals = [abs_oc(tlt, tlt_dates[i]) for i in range(idx-w, idx)]
        vals = [v for v in vals if v is not None]
        return statistics.median(vals) if vals else None
    for e in events:
        e["prior_vol"] = prior_vol(e["nextSession"])
    # clean controls
    def is_clean(d, buf=3):
        if d in event_next:
            return False
        dt = datetime.fromisoformat(d)
        for ed in event_next:
            if abs((dt - datetime.fromisoformat(ed)).days) <= buf:
                return False
        return True
    all_sess = [{"date": d, "abs_ret": abs_oc(tlt, d), "dow": datetime.fromisoformat(d).weekday()}
                for d in tlt_dates if abs_oc(tlt, d) is not None]
    def match(ev_list, k=2):
        used = set()
        ctrls = []
        for e in ev_list:
            if e["prior_vol"] is None:
                continue
            cands = []
            for s in all_sess:
                if s["date"] in used or not is_clean(s["date"]):
                    continue
                if s["dow"] != e["dow"]:
                    continue
                if abs(int(s["date"][:4]) - e["year"]) > 1:
                    continue
                pv = prior_vol(s["date"])
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
        se = math.sqrt(ve/len(er) + vc/len(cr)) if (ve or vc) else 0
        ci = [diff - 1.96*se, diff + 1.96*se]
        psd = math.sqrt(((len(er)-1)*ve + (len(cr)-1)*vc)/(len(er)+len(cr)-2)) if len(er)+len(cr)>2 else 1
        d = diff / psd if psd else 0
        z = diff / se if se else 0
        p = 2 * (1 - 0.5*(1 + math.erf(abs(z)/math.sqrt(2))))
        return {
            "n_event": len(evs), "n_control": len(ctrls),
            "mean_event": me, "mean_control": mc,
            "median_event": statistics.median(er), "median_control": statistics.median(cr),
            "diff_means": diff, "ci95": ci, "cohens_d": d, "approx_p": p,
        }
    # bootstrap
    def bootstrap_diff(evs, ctrls, n=1000):
        er = [e["abs_ret"] for e in evs]
        cr = [c["abs_ret"] for c in ctrls]
        diffs = []
        rng = random.Random(42)
        for _ in range(n):
            es = [rng.choice(er) for _ in er]
            cs = [rng.choice(cr) for _ in cr]
            diffs.append(statistics.mean(es) - statistics.mean(cs))
        diffs.sort()
        return {"boot_mean": statistics.mean(diffs), "boot_ci95": [diffs[int(0.025*n)], diffs[int(0.975*n)]]}
    dev = [e for e in events if e["nextSession"] <= "2018-12-31"]
    val = [e for e in events if "2018-12-31" < e["nextSession"] <= "2024-12-31"]
    full_c = match(events)
    dev_c = match(dev)
    val_c = match(val)
    out = {
        "baseline": "f55aefbd",
        "scheduled_eligible_independent": len(events),
        "hypothesis": "Absolute next-session TLT open-to-close return differs between scheduled FOMC events and matched non-event sessions",
        "full": stats(events, full_c),
        "development_to_2018": stats(dev, dev_c),
        "validation_2019_2024": stats(val, val_c),
        "bootstrap_full": bootstrap_diff(events, full_c),
        "time_status": dict(Counter(e["timeStatus"] for e in events)),
        "matching": "DOW match, year +/-1, prior-20d median abs-ret within 75%, exclude event next and +/-3d buffer",
        "no_lookahead": True,
        "next_session_only": True,
        "sealed_holdout_preserved": "post-2024 unused",
        "multiple_testing_note": "Single primary hypothesis. Prior strategy rejections exist; interpret conservatively.",
    }
    with open("research/lab/fomc-tlt-event-study.json", "w") as f:
        json.dump(out, f, indent=2)
    print(json.dumps({k: out[k] for k in ["scheduled_eligible_independent", "full", "development_to_2018", "validation_2019_2024", "bootstrap_full"]}, indent=2))
    return out

if __name__ == "__main__":
    main()
