import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import oops_eval


def bar(day: str, minute: int, price: float) -> dict:
    start = 13 * 60 + 30 if day == "2024-11-01" else 14 * 60 + 30
    total = start + minute
    return {"t": f"{day}T{total // 60:02d}:{total % 60:02d}:00Z", "o": price, "h": price + 1, "l": price - 1, "c": price, "v": 1}


class Evaluation(unittest.TestCase):
    def test_evaluate_requires_independent_calendar(self):
        with tempfile.TemporaryDirectory() as tmp:
            raw = Path(tmp)
            with patch.object(oops_eval, "RAW", raw), patch.object(oops_eval, "CALENDAR", Path(tmp) / "missing.json"):
                self.assertEqual(oops_eval.evaluate()["status"], "NOT_EVALUATED")

    def test_evaluate_skips_missing_predecessor_and_reports_daily_metrics(self):
        with tempfile.TemporaryDirectory() as tmp:
            raw = Path(tmp) / "SPY"
            raw.mkdir()
            calendar = {
                "source": "alpaca-paper-calendar",
                "dates": [
                    {"date": "2024-11-01", "open": "09:30", "close": "16:00"},
                    {"date": "2024-11-04", "open": "09:30", "close": "16:00"},
                    {"date": "2024-11-05", "open": "09:30", "close": "16:00"},
                ],
            }
            for day in ("2024-11-01", "2024-11-05"):
                rows = [bar(day, minute, 100) for minute in range(390)]
                payload = {"symbol": "SPY", "day": day, "feed": "sip", "sha256": oops_eval.checksum(rows), "rows": rows}
                (raw / f"{day}.json").write_text(json.dumps(payload))
            calendar_path = Path(tmp) / "calendar.json"
            calendar_path.write_text(json.dumps(calendar))
            with patch.object(oops_eval, "RAW", Path(tmp)), patch.object(oops_eval, "CALENDAR", calendar_path):
                result = oops_eval.evaluate()
        self.assertEqual(result["status"], "EVALUATED")
        self.assertIn("sharpe", result["scenarios"]["6"]["longOnly"])
        self.assertLess(result["scenarios"]["6"]["longOnly"]["exposure"], 1)


if __name__ == "__main__":
    unittest.main()
