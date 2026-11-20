import unittest

from oops_eval import metrics, preceding


class Evaluation(unittest.TestCase):
    def test_preceding_requires_calendar_predecessor(self):
        files = [{"day": "2024-11-01", "bars": [{"high": 10, "low": 9}]}]
        calendar = ["2024-11-01", "2024-11-04", "2024-11-05"]
        self.assertIsNone(preceding(files, calendar, "2024-11-05"))
        self.assertEqual(preceding(files, calendar, "2024-11-04")["day"], "2024-11-01")

    def test_capital_constraint_skips_overlapping_notional(self):
        trades = [
            {"entry": "2024-11-01T13:31:00Z", "exit": "2024-11-01T13:40:00Z", "entryPx": 80, "net": 1},
            {"entry": "2024-11-01T13:32:00Z", "exit": "2024-11-01T13:33:00Z", "entryPx": 90, "net": 5},
        ]
        result = metrics(trades, [100, 101])
        self.assertEqual(result["trades"], 1)
        self.assertEqual(result["endingEquity"], 101)


if __name__ == "__main__":
    unittest.main()
