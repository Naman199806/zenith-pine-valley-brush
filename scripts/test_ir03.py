import unittest

from ir03_engine import confirmed_pivots, projected_line, run_bars


def rising() -> list[dict]:
    bars = []
    for i in range(12):
        low = 10 + i * 0.1
        bars.append({"date": f"d{i:02d}", "open": low + 0.4, "high": low + 0.8, "low": low, "close": low + 0.5})
    bars[4]["low"] = 8
    bars[8]["low"] = 9
    bars[6]["high"] = 14
    bars.append({"date": "d12", "open": 12, "high": 15, "low": 12, "close": 14.5})
    bars.append({"date": "d13", "open": 14.6, "high": 14.8, "low": 14.2, "close": 14.4})
    bars.append({"date": "d14", "open": 10, "high": 10.2, "low": 9.5, "close": 9.6})
    bars.append({"date": "d15", "open": 9.4, "high": 9.5, "low": 9.0, "close": 9.2})
    return bars


class Ir03Corrected(unittest.TestCase):
    def test_projected_line_is_not_the_latest_pivot(self):
        older = {"index": 4, "price": 8}
        newer = {"index": 8, "price": 9}
        self.assertGreater(projected_line(older, newer, 12), 9)

    def test_synthetic_entry_and_exit(self):
        result = run_bars(rising(), 0.0)
        self.assertGreaterEqual(len(result["trades"]), 1)
        self.assertIn("exit", result["trades"][0])
        self.assertGreater(result["trades"][0]["exit"], result["trades"][0]["entry"])

    def test_exit_does_not_require_higher_low(self):
        bars = rising()
        bars[8]["low"] = 7
        result = run_bars(bars, 0.0)
        self.assertTrue(result["trades"] or result["open"] is None)

    def test_pivot_confirmation_lag(self):
        bars = [{"date": f"d{i}", "open": 10, "high": 12 if i == 5 else 11, "low": 9, "close": 10} for i in range(12)]
        pivots = confirmed_pivots(bars, "high")
        self.assertTrue(all(p["confirm"] == p["index"] + 2 for p in pivots))


if __name__ == "__main__":
    unittest.main()
