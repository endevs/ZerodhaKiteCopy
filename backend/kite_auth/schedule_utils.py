from __future__ import annotations

from datetime import datetime, time, timedelta, timezone
from typing import List

from .schedule_settings import get_schedule_settings

try:
    from zoneinfo import ZoneInfo

    try:
        IST = ZoneInfo("Asia/Kolkata")
    except Exception:
        IST = timezone(timedelta(hours=5, minutes=30))
except ImportError:
    IST = timezone(timedelta(hours=5, minutes=30))


def _settings():
    return get_schedule_settings()


def schedule_time_label() -> str:
    return _settings().time_label


def now_ist() -> datetime:
    return datetime.now(IST)


def is_scheduled_weekday(dt: datetime) -> bool:
    return dt.weekday() in _settings().weekdays


def slot_start_for(dt: datetime) -> datetime:
    settings = _settings()
    return dt.replace(hour=settings.hour, minute=settings.minute, second=0, microsecond=0)


def slot_iso(dt: datetime) -> str:
    return slot_start_for(dt).isoformat()


def is_due_window(now: datetime | None = None) -> bool:
    """True only at the exact configured schedule minute (strict)."""
    current = now or now_ist()
    settings = _settings()
    if current.weekday() not in settings.weekdays:
        return False
    return current.hour == settings.hour and current.minute == settings.minute


def is_due_window_for_scheduler(now: datetime | None = None) -> bool:
    """
    Scheduler poll tolerance: configured minute or the following minute.
    slot_iso still dedupes per configured slot start; this avoids missing the
  window if the worker is busy for up to one minute.
    """
    current = now or now_ist()
    settings = _settings()
    if current.weekday() not in settings.weekdays:
        return False
    if current.hour != settings.hour:
        return False
    return current.minute in (settings.minute, settings.minute + 1)


def next_weekday_slots(count: int = 5, from_dt: datetime | None = None) -> List[datetime]:
    """Return the next `count` schedule slots on configured weekdays at configured IST time."""
    current = from_dt or now_ist()
    settings = _settings()
    slots: List[datetime] = []
    day = current.date()
    attempts = 0
    while len(slots) < count and attempts < 21:
        if day.weekday() in settings.weekdays:
            candidate = datetime.combine(day, time(settings.hour, settings.minute), tzinfo=IST)
            if candidate >= current.replace(second=0, microsecond=0) - timedelta(minutes=1):
                slots.append(candidate)
        day += timedelta(days=1)
        attempts += 1
    return slots[:count]


def weekday_label(dt: datetime) -> str:
    return dt.strftime("%a")


def schedule_info() -> dict:
    settings = _settings()
    return {
        "description": settings.description,
        "timezone": settings.timezone,
        "weekdays": settings.weekday_labels,
        "weekday_indices": list(settings.weekdays),
        "time": settings.time_label,
        "hour": settings.hour,
        "minute": settings.minute,
        "updated_at": settings.updated_at,
        "updated_by": settings.updated_by,
    }
