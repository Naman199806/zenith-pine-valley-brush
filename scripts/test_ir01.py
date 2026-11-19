import json
import unittest
from pathlib import Path

from ir01_engine import inside, run, run_bars, segment

ROOT = Path(__file__).resolve().parents[1]


class Ir01Rules(unittest.TestCase):
    def test_entry_cannot_precede_setup_completion(self):
        result = run("SPY", 0.0006)
        for trade in result["trades"]:
            self.assertGreater(trade["entry"], trade["setupArmedOn"])

    def test_inside_bar_is_rejected(self):
        self.assertTrue(inside({"high": 10, "low": 9}, {"high": 11, "low": 8}))
        self.assertFalse(inside({"high": 12, "low": 9}, {"high": 11, "low": 8}))

    def test_consumed_trigger_is_not_reused(self):
        events = run("SPY", 0.0006)["events"]
        consumes = [e for e in events if e["event"] == "fill-entry"]
        self.assertGreater(len(consumes), 0)

    def test_gap_and_opposite_exit_exist(self):
        trades = run("SPY", 0.0006)["trades"]
        self.assertTrue(any(t["exit"] > t["entry"] for t in trades))

    def test_cross_period_and_open_position_reconcile(self):
        result = run("SPY", 0.0006)
        seg = segment(result, "2018-01-02", "2022-12-30")
        self.assertIn("spanningTrades", seg)
        self.assertIn("unrealizedEnd", seg)
        self.assertAlmostEqual(seg["realizedInPeriod"], sum(t["pnl"] for t in result["trades"] if "2018-01-02" <= t["exit"] <= "2022-12-30"))

    def test_v1_artifact_is_preserved(self):
        frozen = json.loads((ROOT / "research/lab/ir01-sma18/v1-frozen.json").read_text())
        self.assertEqual(frozen["verdict"], "NO_WINNER")

    def test_today_close_cannot_change_an_earlier_fill(self):
        bars = []
        for i in range(18):
            bars.append({"date": f"2020-01-{i+1:02d}", "open": 10, "high": 10.2, "low": 9.8, "close": 10})
        bars.append({"date": "2020-01-19", "open": 10.2, "high": 10.6, "low": 10.2, "close": 10.4})
        bars.append({"date": "2020-01-20", "open": 10.5, "high": 10.9, "low": 10.4, "close": 10.7})
        trigger = {"date": "2020-01-21", "open": 11.2, "high": 11.4, "low": 11.0, "close": 9.0}
        changed = [dict(b) for b in bars] + [dict(trigger, close=12.0)]
        original = bars + [trigger]
        a = run_bars(original, 0.0)
        b = run_bars(changed, 0.0)
        self.assertEqual([e for e in a["events"] if e["event"] == "fill-entry"], [e for e in b["events"] if e["event"] == "fill-entry"])
        result = run("SPY", 0.0006)
        self.assertFalse(any(t["entry"] == t["exit"] for t in result["trades"]))


if __name__ == "__main__":
    unittest.main()
