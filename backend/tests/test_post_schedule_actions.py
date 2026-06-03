import os
import sys
import tempfile
import unittest
from unittest import mock

from database import ensure_core_schema, get_db_connection
from kite_auth.post_schedule_actions import (
    ensure_options_collection_scheduler,
    refresh_live_deployment_tokens_for_user,
    restart_backend_ticker_for_user,
    stop_global_ticker,
)
from live_trade import create_deployment, ensure_live_trade_tables, get_deployment_by_id, STATUS_ACTIVE


class PostScheduleActionsTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self._db_path = os.path.join(self._tmpdir.name, "test.db")
        os.environ["DATABASE_PATH"] = self._db_path
        import config

        config.DATABASE_PATH = self._db_path
        ensure_core_schema()
        ensure_live_trade_tables()
        conn = get_db_connection()
        conn.execute(
            """
            INSERT INTO users (mobile, email, email_verified, app_key, zerodha_access_token)
            VALUES (?, ?, 1, ?, ?)
            """,
            ("9999999999", "test@example.com", "testkey", "old_token"),
        )
        conn.commit()
        conn.close()

    def tearDown(self) -> None:
        self._tmpdir.cleanup()

    def test_ensure_options_scheduler(self) -> None:
        sys.modules.pop("options_scheduler", None)
        fake_scheduler = mock.MagicMock()
        fake_scheduler.start_scheduler = mock.MagicMock(return_value=True)
        with mock.patch.dict("sys.modules", {"options_scheduler": fake_scheduler}):
            ensure_options_collection_scheduler()
        fake_scheduler.start_scheduler.assert_called_once()

    @mock.patch("kite_auth.post_schedule_actions._validate_access_token")
    @mock.patch("kite_auth.post_schedule_actions.stop_global_ticker")
    def test_restart_ticker_skips_without_credentials(
        self, _stop: mock.MagicMock, _validate: mock.MagicMock
    ) -> None:
        conn = get_db_connection()
        conn.execute(
            "UPDATE users SET app_key = NULL, zerodha_access_token = NULL WHERE id = 1"
        )
        conn.commit()
        conn.close()
        self.assertFalse(restart_backend_ticker_for_user(1))
        _validate.assert_not_called()

    def test_refresh_live_deployment_tokens(self) -> None:
        conn = get_db_connection()
        conn.execute(
            "UPDATE users SET zerodha_access_token = ? WHERE id = 1",
            ("new_token_abc",),
        )
        conn.commit()
        conn.close()
        dep = create_deployment(
            user_id=1,
            strategy_id=None,
            strategy_name="Test",
            initial_investment=1000.0,
            scheduled_start=None,
            status=STATUS_ACTIVE,
            kite_access_token="old_token",
        )
        count = refresh_live_deployment_tokens_for_user(1)
        self.assertEqual(count, 1)
        deployment = get_deployment_by_id(dep["id"])
        self.assertEqual(deployment["kite_access_token"], "new_token_abc")


if __name__ == "__main__":
    unittest.main()
