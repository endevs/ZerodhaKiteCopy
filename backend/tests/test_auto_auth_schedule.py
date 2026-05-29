import datetime
import os
import sqlite3
import tempfile
import unittest

from database import ensure_core_schema, get_db_connection
from kite_auth.schedule_runs import already_ran_for_slot, build_upcoming_runs, insert_run
from kite_auth.schedule_settings import (
    get_schedule_settings,
    invalidate_cache,
    update_schedule_settings,
    validate_schedule_input,
)
from kite_auth.schedule_utils import (
    IST,
    is_due_window,
    next_weekday_slots,
    schedule_info,
    slot_iso,
)


class ScheduleSettingsTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self._db_path = os.path.join(self._tmpdir.name, "test.db")
        os.environ["DATABASE_PATH"] = self._db_path
        import config

        config.DATABASE_PATH = self._db_path
        ensure_core_schema()
        invalidate_cache()

    def tearDown(self) -> None:
        invalidate_cache()
        self._tmpdir.cleanup()

    def test_default_settings_mon_fri_845(self) -> None:
        settings = get_schedule_settings(force_refresh=True)
        self.assertEqual(settings.hour, 8)
        self.assertEqual(settings.minute, 45)
        self.assertEqual(settings.weekdays, (0, 1, 2, 3, 4))

    def test_update_tue_thu_930(self) -> None:
        update_schedule_settings(hour=9, minute=30, weekdays=[1, 3], updated_by=1)
        settings = get_schedule_settings(force_refresh=True)
        self.assertEqual(settings.hour, 9)
        self.assertEqual(settings.minute, 30)
        self.assertEqual(settings.weekdays, (1, 3))

        due = datetime.datetime(2026, 5, 26, 9, 30, tzinfo=IST)  # Tue
        not_due_day = datetime.datetime(2026, 5, 28, 9, 30, tzinfo=IST)  # Thu ok
        wrong_day = datetime.datetime(2026, 5, 27, 9, 30, tzinfo=IST)  # Wed
        self.assertTrue(is_due_window(due))
        self.assertTrue(is_due_window(not_due_day))
        self.assertFalse(is_due_window(wrong_day))

    def test_validate_rejects_empty_weekdays(self) -> None:
        with self.assertRaises(ValueError):
            validate_schedule_input(8, 45, [])


class ScheduleUtilsTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self._db_path = os.path.join(self._tmpdir.name, "test.db")
        os.environ["DATABASE_PATH"] = self._db_path
        import config

        config.DATABASE_PATH = self._db_path
        ensure_core_schema()
        invalidate_cache()

    def tearDown(self) -> None:
        invalidate_cache()
        self._tmpdir.cleanup()

    def test_next_weekday_slots_skips_unconfigured_days(self) -> None:
        update_schedule_settings(hour=8, minute=45, weekdays=[0, 1, 2, 3, 4], updated_by=1)
        saturday = datetime.datetime(2026, 5, 30, 10, 0, tzinfo=IST)
        slots = next_weekday_slots(3, from_dt=saturday)
        self.assertEqual(len(slots), 3)
        for slot in slots:
            self.assertLess(slot.weekday(), 5)

    def test_schedule_info_reflects_db_settings(self) -> None:
        update_schedule_settings(hour=10, minute=15, weekdays=[2, 4], updated_by=1)
        info = schedule_info()
        self.assertEqual(info["hour"], 10)
        self.assertEqual(info["minute"], 15)
        self.assertIn("Wed", info["weekdays"])


class ScheduleRunsTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self._db_path = os.path.join(self._tmpdir.name, "test.db")
        os.environ["DATABASE_PATH"] = self._db_path
        import config

        config.DATABASE_PATH = self._db_path
        ensure_core_schema()
        conn = get_db_connection()
        conn.execute(
            "INSERT INTO users (mobile, email, email_verified) VALUES (?, ?, 1)",
            ("9999999999", "test@example.com"),
        )
        conn.commit()
        conn.close()
        self.user_id = 1
        invalidate_cache()

    def tearDown(self) -> None:
        invalidate_cache()
        self._tmpdir.cleanup()

    def test_dedupe_same_user_slot(self) -> None:
        slot = slot_iso(datetime.datetime(2026, 5, 28, 8, 45, tzinfo=IST))
        insert_run(self.user_id, slot, status="pending")
        self.assertTrue(already_ran_for_slot(self.user_id, slot))
        insert_run(self.user_id, slot, status="skipped", reason="token_valid")
        conn = get_db_connection()
        count = conn.execute(
            "SELECT COUNT(*) AS c FROM user_auto_auth_runs WHERE user_id = ? AND scheduled_for = ?",
            (self.user_id, slot),
        ).fetchone()["c"]
        conn.close()
        self.assertEqual(count, 1)

    def test_build_upcoming_runs_marks_unknown_as_scheduled(self) -> None:
        update_schedule_settings(hour=8, minute=45, weekdays=[0, 1, 2, 3, 4], updated_by=1)
        slots = next_weekday_slots(2, from_dt=datetime.datetime(2026, 5, 28, 9, 0, tzinfo=IST))
        upcoming = build_upcoming_runs(self.user_id, slots)
        self.assertEqual(len(upcoming), 2)
        self.assertEqual(upcoming[0]["status"], "scheduled")


if __name__ == "__main__":
    unittest.main()
