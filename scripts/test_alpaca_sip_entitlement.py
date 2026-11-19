import unittest
from datetime import datetime, timedelta, timezone

from alpaca_sip_entitlement import END, START, expected_minutes, normalize_timestamp, summarize


def bar(stamp: datetime, **overrides) -> dict:
    row = {"t": stamp.strftime("%Y-%m-%dT%H:%M:%S.%fZ"), "o": 10, "h": 11, "l": 9, "c": 10.5, "v": 100}
    row.update(overrides)
    return row


def session() -> list[dict]:
    cursor = START
    bars = []
    while cursor <= END:
        bars.append(bar(cursor))
        cursor += timedelta(minutes=1)
    return bars


class SipValidation(unittest.TestCase):
    def test_valid_session_passes(self):
        result = summarize(session())
        self.assertEqual(result["expectedMinutes"], 390)
        self.assertEqual(result["missingMinutes"], 0)
        self.assertEqual(result["duplicates"], 0)
        self.assertEqual(result["outOfSessionBars"], 0)
        self.assertEqual(result["malformedTimestamps"], 0)
        self.assertEqual(result["ohlcvFailures"], 0)
        self.assertFalse(result["includes1600Et"])

    def test_missing_duplicate_malformed_and_out_of_session(self):
        bars = session()
        del bars[10]
        bars.append(bars[0])
        bars.append({"t": "not-a-time", "o": 10, "h": 11, "l": 9, "c": 10, "v": 1})
        bars.append(bar(datetime(2024, 11, 1, 20, 0, tzinfo=timezone.utc)))
        bars[1]["h"] = 8
        result = summarize(bars)
        self.assertEqual(result["missingMinutes"], 1)
        self.assertEqual(result["duplicates"], 1)
        self.assertEqual(result["malformedTimestamps"], 1)
        self.assertEqual(result["outOfSessionBars"], 1)
        self.assertEqual(result["ohlcvFailures"], 1)
        self.assertTrue(result["includes1600Et"])

    def test_iso_normalization(self):
        self.assertEqual(normalize_timestamp("2024-11-01T13:30:00.123456Z"), "2024-11-01T13:30:00Z")
        self.assertIsNone(normalize_timestamp("2024-11-01T13:30:Z"))


if __name__ == "__main__":
    unittest.main()
