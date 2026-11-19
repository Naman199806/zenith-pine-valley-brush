import unittest

from oops_engine import run_session


PRIOR = {"high": 100, "low": 90}


def minute(stamp: str, open_: float, high: float, low: float, close: float) -> dict:
    return {"t": stamp, "open": open_, "high": high, "low": low, "close": close}


class Oops(unittest.TestCase):
    def test_gap_down_reversal_enters(self):
        bars = [
            minute("09:30", 89, 89.5, 88.5, 89),
            minute("09:31", 89.2, 90.4, 89.1, 90.2),
            minute("09:32", 90.2, 91, 90, 90.8),
        ]
        trade = run_session(PRIOR, bars, 0)
        self.assertEqual(trade["side"], "long")
        self.assertEqual(trade["entryPx"], 90)
        self.assertFalse(trade["sameMinuteStop"])

    def test_same_minute_stop_is_conservative(self):
        bars = [
            minute("09:30", 89, 89.2, 88, 89),
            minute("09:31", 89.5, 90.2, 87.5, 89.1),
        ]
        trade = run_session(PRIOR, bars, 0)
        self.assertTrue(trade["sameMinuteStop"])
        self.assertLess(trade["netReturn"], 0)

    def test_no_gap_is_no_trade(self):
        bars = [minute("09:30", 95, 96, 94, 95)]
        self.assertIsNone(run_session(PRIOR, bars))


if __name__ == "__main__":
    unittest.main()
