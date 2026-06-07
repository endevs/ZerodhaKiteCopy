import datetime
import os
import tempfile
import unittest

from database import ensure_core_schema, get_db_connection
from migrate_option_chain_quotes import ensure_option_chain_quote_schema
from option_chain_board import pick_default_expiry, strike_step
from option_iv import implied_volatility
from option_spike_detector import evaluate_spike, persist_spike_events


class OptionChainBoardTests(unittest.TestCase):
    def test_pick_default_expiry(self) -> None:
        today = datetime.date(2026, 6, 3)
        expiries = ["2026-06-01", "2026-06-10", "2026-06-17"]
        self.assertEqual(pick_default_expiry(expiries, today), "2026-06-10")

    def test_strike_step(self) -> None:
        self.assertEqual(strike_step("NIFTY"), 50)
        self.assertEqual(strike_step("BANKNIFTY"), 100)

    def test_implied_volatility_positive(self) -> None:
        iv = implied_volatility(150.0, 24000.0, 24000.0, 7.0, "CE")
        self.assertIsNotNone(iv)
        self.assertGreater(iv, 0)


class OptionSpikeTests(unittest.TestCase):
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

    def test_spike_detects_ltp_move(self) -> None:
        td = "2026-06-03"
        token = 999001
        conn = get_db_connection()
        conn.execute(
            """
            INSERT INTO option_quote_ticks
            (instrument_token, tradingsymbol, index_name, trading_date, expiry_date,
             strike, instrument_type, ts, ltp, iv, oi, volume)
            VALUES (?, 'NIFTY26JUN24000CE', 'NIFTY', ?, '2026-06-10', 24000, 'CE',
                    '2026-06-03T10:00:00', 100.0, 15.0, 1000, 0)
            """,
            (token, td),
        )
        conn.commit()
        conn.close()

        events = evaluate_spike(
            instrument_token=token,
            tradingsymbol="NIFTY26JUN24000CE",
            index_name="NIFTY",
            trading_date=td,
            expiry_date="2026-06-10",
            strike=24000.0,
            instrument_type="CE",
            ts="2026-06-03T10:00:30",
            ltp=106.0,
            iv=15.0,
        )
        self.assertTrue(any(e["metric"] == "ltp_pct" for e in events))
        n = persist_spike_events(events)
        self.assertGreaterEqual(n, 1)


if __name__ == "__main__":
    unittest.main()
