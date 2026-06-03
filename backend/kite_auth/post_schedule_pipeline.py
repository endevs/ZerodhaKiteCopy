"""
Post-schedule pipeline: hooks run after a scheduled auto-auth slot resolves.

Design rules for hooks:
- Use DB token (users.zerodha_access_token), not Flask session['access_token'].
- Do not depend on Socket.IO or a browser tab.
- Live deployments snapshot kite_access_token at deploy time; refresh via a dedicated hook.

Phase 1: structured logging only (superseded for default hooks).
Phase 2: restart options scheduler, ticker, deployment tokens, paper/live monitors via post_schedule_actions.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Callable, List, Literal

logger = logging.getLogger(__name__)

AuthOutcome = Literal[
    "succeeded",
    "failed",
    "needs_manual",
    "skipped_token_valid",
    "skipped_already_running",
]
Trigger = Literal["schedule"]

_HOOKS: List[Callable[["PostScheduleContext"], None]] = []
_REGISTERED_DEFAULTS = False


@dataclass(frozen=True)
class PostScheduleContext:
    user_id: int
    slot_iso: str
    auth_outcome: AuthOutcome
    trigger: Trigger = "schedule"


def register_post_schedule_hook(fn: Callable[[PostScheduleContext], None]) -> None:
    if fn not in _HOOKS:
        _HOOKS.append(fn)


def clear_post_schedule_hooks() -> None:
    """Test helper: remove all hooks."""
    global _REGISTERED_DEFAULTS
    _HOOKS.clear()
    _REGISTERED_DEFAULTS = False


def _ensure_default_hooks() -> None:
    global _REGISTERED_DEFAULTS
    if _REGISTERED_DEFAULTS:
        return
    register_post_schedule_hook(log_post_schedule_outcome)
    register_post_schedule_hook(start_options_collection)
    register_post_schedule_hook(start_backend_ticker)
    register_post_schedule_hook(refresh_live_deployment_tokens)
    register_post_schedule_hook(start_paper_trades)
    register_post_schedule_hook(start_live_trades)
    _REGISTERED_DEFAULTS = True


def run_post_schedule_pipeline(ctx: PostScheduleContext) -> None:
    _ensure_default_hooks()
    logger.info(
        "post_schedule_pipeline: user_id=%s slot=%s outcome=%s trigger=%s",
        ctx.user_id,
        ctx.slot_iso,
        ctx.auth_outcome,
        ctx.trigger,
    )
    for hook in list(_HOOKS):
        name = getattr(hook, "__name__", repr(hook))
        try:
            hook(ctx)
            logger.debug("post_schedule_pipeline: hook %s completed", name)
        except Exception as exc:
            logger.warning(
                "post_schedule_pipeline: hook %s failed for user_id=%s: %s",
                name,
                ctx.user_id,
                exc,
                exc_info=True,
            )


def log_post_schedule_outcome(ctx: PostScheduleContext) -> None:
    logger.info(
        "post_schedule_pipeline outcome user_id=%s slot=%s auth_outcome=%s",
        ctx.user_id,
        ctx.slot_iso,
        ctx.auth_outcome,
    )


def start_options_collection(ctx: PostScheduleContext) -> None:
    if ctx.auth_outcome not in ("succeeded", "skipped_token_valid"):
        return
    from kite_auth.post_schedule_actions import ensure_options_collection_scheduler

    ensure_options_collection_scheduler()


def start_backend_ticker(ctx: PostScheduleContext) -> None:
    if ctx.auth_outcome not in ("succeeded", "skipped_token_valid"):
        return
    from kite_auth.post_schedule_actions import restart_backend_ticker_for_user

    restart_backend_ticker_for_user(ctx.user_id)


def refresh_live_deployment_tokens(ctx: PostScheduleContext) -> None:
    if ctx.auth_outcome not in ("succeeded", "skipped_token_valid"):
        return
    from kite_auth.post_schedule_actions import refresh_live_deployment_tokens_for_user

    refresh_live_deployment_tokens_for_user(ctx.user_id)


def start_paper_trades(ctx: PostScheduleContext) -> None:
    if ctx.auth_outcome not in ("succeeded", "skipped_token_valid"):
        return
    from kite_auth.post_schedule_actions import refresh_paper_trades_for_user

    refresh_paper_trades_for_user(ctx.user_id)


def start_live_trades(ctx: PostScheduleContext) -> None:
    if ctx.auth_outcome not in ("succeeded", "skipped_token_valid"):
        return
    from kite_auth.post_schedule_actions import resume_live_trades_for_user

    resume_live_trades_for_user(ctx.user_id)
