import os
import tempfile
import unittest

from database import ensure_core_schema, get_db_connection
from migrate_option_chain_quotes import ensure_option_chain_quote_schema
from option_chain_capture import ingest_quote_row
from option_chain_metrics import compute_day_changes, resolve_prev_close


class OptionChainMetricsTests(unittest.TestCase):
    def test_compute_day_changes_sensibull_example(self) -> None:
        changes = compute_day_changes(190.70, 15.0, 188.00, 14.0)
        self.assertEqual(changes["ltp_chg"], 2.70)
        self.assertAlmostEqual(changes["ltp_chg_pct"], 1.44, places=2)
        self.assertEqual(changes["iv_chg"], 1.0)
        self.assertAlmostEqual(changes["iv_chg_pct"], 7.14, places=2)

    def test_compute_day_changes_without_baseline(self) -> None:
        changes = compute_day_changes(100.0, 12.0, None, None)
        self.assertIsNone(changes["ltp_chg"])
        self.assertIsNone(changes["ltp_chg_pct"])
        self.assertIsNone(changes["iv_chg"])

    def test_resolve_prev_close_prefers_ohlc(self) -> None:
        quote = {"ohlc": {"close": 188.0}}
        existing = {"prev_close": 180.0}
        self.assertEqual(resolve_prev_close(quote, existing), 188.0)

    def test_resolve_prev_close_falls_back_to_db(self) -> None:
        quote = {}
        existing = {"prev_close": 180.0}
        self.assertEqual(resolve_prev_close(quote, existing), 180.0)


class IngestQuoteRowBaselineTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self._db_path = os.path.join(self._tmpdir.name, "test.db")
        os.environ["DATABASE_PATH"] = self._db_path
        import config

        config.DATABASE_PATH = self._db_path
        ensure_core_schema()
        ensure_option_chain_quote_schema()

    def tearDown(self) -> None:
        self._tmpdir.cleanup()

    def test_ingest_uses_prev_close_not_last_tick(self) -> None:
        contract = {
            "instrument_token": 123456,
            "tradingsymbol": "NIFTY26JUN23200CE",
            "strike": 23200.0,
            "expiry_date": "2026-06-16",
            "instrument_type": "CE",
            "index_name": "NIFTY",
            "trading_date": "2026-06-11",
        }
        quote1 = {"last_price": 190.0, "ohlc": {"close": 188.0}, "oi": 1000, "volume": 10}
        ingest_quote_row(contract, quote1, spot=23250.0, index_prev_close=23100.0)

        quote2 = {"last_price": 192.0, "ohlc": {"close": 188.0}, "oi": 1100, "volume": 12}
        ingest_quote_row(contract, quote2, spot=23250.0, index_prev_close=23100.0)

        conn = get_db_connection()
        row = conn.execute(
            """
            SELECT ltp, ltp_chg, ltp_chg_pct, prev_close, iv_prev_close
            FROM option_quote_latest
            WHERE instrument_token = ? AND trading_date = ?
            """,
            (123456, "2026-06-11"),
        ).fetchone()
        conn.close()

        self.assertIsNotNone(row)
        self.assertEqual(row[0], 192.0)
        self.assertEqual(row[1], 4.0)
        self.assertAlmostEqual(row[2], (4.0 / 188.0) * 100.0, places=2)
        self.assertEqual(row[3], 188.0)
        self.assertIsNotNone(row[4])

    def test_iv_prev_close_stable_across_ingests(self) -> None:
        contract = {
            "instrument_token": 123457,
            "tradingsymbol": "NIFTY26JUN23250PE",
            "strike": 23250.0,
            "expiry_date": "2026-06-16",
            "instrument_type": "PE",
            "index_name": "NIFTY",
            "trading_date": "2026-06-11",
        }
        base_quote = {"ohlc": {"close": 182.45}, "oi": 500, "volume": 5}
        ingest_quote_row(
            contract,
            {**base_quote, "last_price": 154.95},
            spot=23254.0,
            index_prev_close=23180.0,
        )
        ingest_quote_row(
            contract,
            {**base_quote, "last_price": 156.00},
            spot=23254.0,
            index_prev_close=23180.0,
        )

        conn = get_db_connection()
        rows = conn.execute(
            """
            SELECT iv_prev_close, iv_chg FROM option_quote_latest
            WHERE instrument_token = ? AND trading_date = ?
            """,
            (123457, "2026-06-11"),
        ).fetchone()
        conn.close()

        self.assertIsNotNone(rows[0])
        first_iv_prev = rows[0]
        self.assertIsNotNone(rows[1])


if __name__ == "__main__":
    unittest.main()
