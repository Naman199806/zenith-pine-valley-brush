import unittest

from ir03_engine import confirmed_pivots, run


class Ir03Rules(unittest.TestCase):
    def test_pivot_waits_two_bars(self):
        bars = [{"date": f"d{i}", "open": 10, "high": 11, "low": 9 if i != 5 else 7, "close": 10} for i in range(12)]
        pivots = confirmed_pivots(bars)
        self.assertTrue(all(p["confirm"] == p["index"] + 2 for p in pivots))

    def test_no_lookahead_entry(self):
        result = run("SPY", 0.0006)
        self.assertTrue(all(t["exit"] > t["entry"] for t in result["trades"]))
        self.assertGreater(result["endingEquity"], 0)


if __name__ == "__main__":
    unittest.main()
