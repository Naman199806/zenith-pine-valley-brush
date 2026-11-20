import unittest

from oops_engine import normalize_rows, run_session


PRIOR = {"high": 100, "low": 90}


def minute(stamp: str, open_: float, high: float, low: float, close: float, evidence: dict | None = None) -> dict:
    bar = {"t": stamp, "open": open_, "high": high, "low": low, "close": close}
    if evidence is not None:
        bar["evidence"] = evidence
    return bar


class Oops(unittest.TestCase):
    def test_long_reversal(self):
        bars = [minute("09:30", 89, 89.5, 88.5, 89), minute("09:31", 89.2, 90.4, 89.1, 90.2), minute("09:32", 90.2, 91, 90, 90.8)]
        trade = run_session(PRIOR, bars, 0)
        self.assertEqual(trade["side"], "long")
        self.assertFalse(trade["sameMinuteStop"])

    def test_short_reversal(self):
        bars = [minute("09:30", 101, 101.5, 100.8, 101.2), minute("09:31", 100.8, 100.9, 99.5, 99.8), minute("09:32", 99.8, 100, 99.4, 99.6)]
        trade = run_session(PRIOR, bars, 0)
        self.assertEqual(trade["side"], "short")

    def test_insufficient_evidence_stays_conservative(self):
        bars = [minute("09:30", 89, 89.2, 88, 89), minute("09:31", 87, 90.2, 86.5, 89.1, evidence={"sufficient": True})]
        trade = run_session(PRIOR, bars, 0)
        self.assertEqual(trade["resolution"], "conservative")

    def test_gap_through_stop_uses_open(self):
        bars = [minute("09:30", 89, 89.2, 88, 89), minute("09:31", 87, 90.2, 86.5, 89.1)]
        trade = run_session(PRIOR, bars, 0)
        self.assertTrue(trade["sameMinuteStop"])
        self.assertEqual(trade["exitPx"], 87)

    def test_rejects_incomplete_session(self):
        with self.assertRaises(ValueError):
            run_session(PRIOR, [minute("09:30", 89, 90, 88, 89)])

    def test_adapter_rejects_bad_bar(self):
        with self.assertRaises(ValueError):
            normalize_rows([{"t": "not-a-time", "o": 1, "h": 1, "l": 1, "c": 1, "v": 1}])


if __name__ == "__main__":
    unittest.main()
