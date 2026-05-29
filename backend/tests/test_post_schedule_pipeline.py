import datetime
import os
import tempfile
import unittest
from unittest import mock

from database import ensure_core_schema, get_db_connection
from kite_auth.post_schedule_pipeline import (
    PostScheduleContext,
    clear_post_schedule_hooks,
    register_post_schedule_hook,
    run_post_schedule_pipeline,
)
from kite_auth.schedule_runs import already_ran_for_slot, insert_run
from kite_auth.schedule_settings import invalidate_cache, update_schedule_settings
from kite_auth.schedule_utils import IST, is_due_window, is_due_window_for_scheduler, slot_iso


class PostSchedulePipelineTests(unittest.TestCase):
    def setUp(self) -> None:
        clear_post_schedule_hooks()

    def tearDown(self) -> None:
        clear_post_schedule_hooks()

    def test_hook_exception_does_not_block_next_hook(self) -> None:
        calls: list[str] = []

        def bad(_ctx: PostScheduleContext) -> None:
            calls.append("bad")
            raise RuntimeError("hook failed")

        def good(_ctx: PostScheduleContext) -> None:
            calls.append("good")

        register_post_schedule_hook(bad)
        register_post_schedule_hook(good)
        run_post_schedule_pipeline(
            PostScheduleContext(user_id=1, slot_iso="2026-05-28T08:45:00+05:30", auth_outcome="succeeded")
        )
        self.assertEqual(calls, ["bad", "good"])

    def test_default_hooks_run_for_succeeded(self) -> None:
        with self.assertLogs("kite_auth.post_schedule_pipeline", level="INFO") as logs:
            run_post_schedule_pipeline(
                PostScheduleContext(
                    user_id=1,
                    slot_iso="2026-05-28T08:45:00+05:30",
                    auth_outcome="succeeded",
                )
            )
        joined = "\n".join(logs.output)
        self.assertIn("post_schedule_pipeline outcome", joined)
        self.assertIn("start_options_collection not implemented", joined)

    def test_stubs_skip_on_failed_outcome(self) -> None:
        with self.assertLogs("kite_auth.post_schedule_pipeline", level="INFO") as logs:
            run_post_schedule_pipeline(
                PostScheduleContext(
                    user_id=1,
                    slot_iso="2026-05-28T08:45:00+05:30",
                    auth_outcome="failed",
                )
            )
        joined = "\n".join(logs.output)
        self.assertIn("post_schedule_pipeline outcome", joined)
        self.assertNotIn("start_options_collection not implemented", joined)


class SchedulerDueWindowTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self._db_path = os.path.join(self._tmpdir.name, "test.db")
        os.environ["DATABASE_PATH"] = self._db_path
        import config

        config.DATABASE_PATH = self._db_path
        ensure_core_schema()
        invalidate_cache()
        update_schedule_settings(hour=8, minute=45, weekdays=[0, 1, 2, 3, 4], updated_by=1)

    def tearDown(self) -> None:
        invalidate_cache()
        self._tmpdir.cleanup()

    def test_scheduler_tolerance_includes_following_minute(self) -> None:
        exact = datetime.datetime(2026, 5, 28, 8, 45, tzinfo=IST)
        grace = datetime.datetime(2026, 5, 28, 8, 46, tzinfo=IST)
        late = datetime.datetime(2026, 5, 28, 8, 47, tzinfo=IST)
        self.assertTrue(is_due_window_for_scheduler(exact))
        self.assertTrue(is_due_window_for_scheduler(grace))
        self.assertFalse(is_due_window_for_scheduler(late))
        self.assertTrue(is_due_window(exact))
        self.assertFalse(is_due_window(grace))

    def test_slot_dedupe_prevents_duplicate_runs(self) -> None:
        slot = slot_iso(datetime.datetime(2026, 5, 28, 8, 45, tzinfo=IST))
        conn = get_db_connection()
        conn.execute(
            "INSERT INTO users (mobile, email, email_verified) VALUES (?, ?, 1)",
            ("9999999999", "test@example.com"),
        )
        conn.commit()
        conn.close()
        user_id = 1
        insert_run(user_id, slot, status="skipped", reason="token_valid")
        self.assertTrue(already_ran_for_slot(user_id, slot))


class ScheduleRunsFinalizeTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self._db_path = os.path.join(self._tmpdir.name, "test.db")
        os.environ["DATABASE_PATH"] = self._db_path
        import config

        config.DATABASE_PATH = self._db_path
        ensure_core_schema()
        invalidate_cache()
        conn = get_db_connection()
        conn.execute(
            "INSERT INTO users (mobile, email, email_verified) VALUES (?, ?, 1)",
            ("9999999999", "test@example.com"),
        )
        conn.commit()
        conn.close()

    def tearDown(self) -> None:
        invalidate_cache()
        self._tmpdir.cleanup()

    def test_finalize_latest_pending_run_returns_slot(self) -> None:
        from kite_auth.schedule_runs import finalize_latest_pending_run, insert_run

        slot = slot_iso(datetime.datetime(2026, 5, 28, 8, 45, tzinfo=IST))
        insert_run(1, slot, status="pending")
        returned = finalize_latest_pending_run(1, status="succeeded", reason=None)
        self.assertEqual(returned, slot)
        conn = get_db_connection()
        row = conn.execute(
            "SELECT status FROM user_auto_auth_runs WHERE user_id = ? AND scheduled_for = ?",
            (1, slot),
        ).fetchone()
        conn.close()
        self.assertEqual(row["status"], "succeeded")

    def test_token_valid_slot_flow_skips_then_pipeline(self) -> None:
        from kite_auth.schedule_runs import insert_run

        clear_post_schedule_hooks()
        calls: list[str] = []

        def capture(ctx: PostScheduleContext) -> None:
            calls.append(ctx.auth_outcome)

        register_post_schedule_hook(capture)
        slot = slot_iso(datetime.datetime(2026, 5, 28, 8, 45, tzinfo=IST))
        insert_run(1, slot, status="skipped", reason="token_valid")
        with mock.patch(
            "kite_auth.post_schedule_pipeline._ensure_default_hooks",
            lambda: None,
        ):
            run_post_schedule_pipeline(
                PostScheduleContext(user_id=1, slot_iso=slot, auth_outcome="skipped_token_valid")
            )
        self.assertEqual(calls, ["skipped_token_valid"])
        self.assertTrue(already_ran_for_slot(1, slot))
        clear_post_schedule_hooks()


if __name__ == "__main__":
    unittest.main()
