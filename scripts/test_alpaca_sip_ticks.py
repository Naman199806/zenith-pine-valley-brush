import unittest

from alpaca_sip_ticks import causal_quote, timestamp, valid_quote, valid_trade


class TickIntegrity(unittest.TestCase):
    def test_nanosecond_timestamp_preserved(self):
        self.assertEqual(timestamp("2024-11-01T13:30:00.123456789Z"), "2024-11-01T13:30:00.123456789Z")
        self.assertIsNone(timestamp("bad"))

    def test_rejects_stale_or_crossed_quote(self):
        self.assertFalse(valid_quote({"t": "bad", "bp": 1, "ap": 2, "bs": 1, "as": 1}))
        self.assertFalse(valid_quote({"t": "2024-11-01T13:30:00Z", "bp": 2, "ap": 1, "bs": 1, "as": 1}))
        self.assertTrue(valid_quote({"t": "2024-11-01T13:30:00Z", "bp": 1, "ap": 1.1, "bs": 10, "as": 10}))

    def test_causal_quote_does_not_use_future(self):
        rows = [
            {"t": "2024-11-01T13:30:00Z", "bp": 1, "ap": 1.1, "bs": 1, "as": 1},
            {"t": "2024-11-01T13:30:02Z", "bp": 2, "ap": 2.1, "bs": 1, "as": 1},
        ]
        self.assertEqual(causal_quote(rows, "2024-11-01T13:30:01Z")["bp"], 1)
        self.assertIsNone(causal_quote(rows, "2024-11-01T13:29:59Z"))

    def test_trade_validation(self):
        self.assertTrue(valid_trade({"t": "2024-11-01T13:30:00Z", "p": 100, "s": 1}))
        self.assertFalse(valid_trade({"t": "2024-11-01T13:30:00Z", "p": 0, "s": 1}))


if __name__ == "__main__":
    unittest.main()
