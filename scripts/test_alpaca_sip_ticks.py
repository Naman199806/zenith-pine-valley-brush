import unittest

from alpaca_sip_ticks import causal_quote, eligible, epoch_ns, timestamp, valid_quote, valid_trade


class TickIntegrity(unittest.TestCase):
    def test_nanosecond_timestamp_preserved(self):
        self.assertEqual(timestamp("2024-11-01T13:30:00.123456789Z"), "2024-11-01T13:30:00.123456789Z")
        self.assertEqual(epoch_ns("2024-11-01T13:30:00.123456789Z") % 1_000_000_000, 123456789)
        self.assertIsNone(timestamp("bad"))

    def test_epoch_ordering_beats_string_width(self):
        self.assertLess(epoch_ns("2024-11-01T13:30:00.9Z"), epoch_ns("2024-11-01T13:30:00.99Z"))
        self.assertGreater("2024-11-01T13:30:00.9Z", "2024-11-01T13:30:00.99Z")

    def test_rejects_stale_future_empty_and_out_of_window(self):
        rows = [
            {"t": "2024-11-01T13:30:00Z", "bp": 1, "ap": 1.1, "bs": 1, "as": 1, "c": []},
            {"t": "2024-11-01T13:30:10Z", "bp": 2, "ap": 2.1, "bs": 1, "as": 1, "c": []},
        ]
        self.assertIsNone(causal_quote([], "2024-11-01T13:30:01Z", "2024-11-01T13:30:00Z", "2024-11-01T13:30:05Z"))
        self.assertIsNone(causal_quote(rows, "2024-11-01T13:30:09Z", "2024-11-01T13:30:00Z", "2024-11-01T13:30:05Z"))
        self.assertIsNone(causal_quote(rows, "2024-11-01T13:29:59Z", "2024-11-01T13:30:00Z", "2024-11-01T13:30:05Z"))
        self.assertEqual(causal_quote(rows, "2024-11-01T13:30:01Z", "2024-11-01T13:30:00Z", "2024-11-01T13:30:05Z")["bp"], 1)

    def test_execution_eligibility_requires_positive_size_and_conditions(self):
        self.assertFalse(eligible({"s": 0, "c": []}, "trades"))
        self.assertFalse(eligible({"s": 1, "c": ["Z"]}, "trades"))
        self.assertTrue(valid_trade({"t": "2024-11-01T13:30:00Z", "p": 100, "s": 1}))


if __name__ == "__main__":
    unittest.main()
