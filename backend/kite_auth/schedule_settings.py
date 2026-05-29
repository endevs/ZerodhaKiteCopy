from __future__ import annotations

import datetime
import os
import threading
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

from database import get_db_connection

WEEKDAY_LABELS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
DEFAULT_WEEKDAYS = (0, 1, 2, 3, 4)
DEFAULT_HOUR = 8
DEFAULT_MINUTE = 45
DEFAULT_TIMEZONE = "Asia/Kolkata"

_cache_lock = threading.Lock()
_cached_settings: Optional["ScheduleSettings"] = None


@dataclass(frozen=True)
class ScheduleSettings:
    hour: int
    minute: int
    weekdays: Tuple[int, ...]
    timezone: str
    updated_at: Optional[str] = None
    updated_by: Optional[int] = None

    @property
    def time_label(self) -> str:
        return f"{self.hour:02d}:{self.minute:02d}"

    @property
    def weekday_labels(self) -> List[str]:
        return [WEEKDAY_LABELS[d] for d in self.weekdays if 0 <= d < 7]

    @property
    def description(self) -> str:
        labels = self.weekday_labels
        if not labels:
            return f"{self.time_label} IST"
        if labels == ["Mon", "Tue", "Wed", "Thu", "Fri"]:
            day_part = "Mon–Fri"
        else:
            day_part = ", ".join(labels)
        hour = self.hour
        minute = self.minute
        suffix = "AM" if hour < 12 else "PM"
        display_hour = hour % 12 or 12
        if minute:
            time_part = f"{display_hour}:{minute:02d} {suffix}"
        else:
            time_part = f"{display_hour} {suffix}"
        return f"{day_part} {time_part} IST"

    def to_dict(self) -> Dict[str, object]:
        return {
            "hour": self.hour,
            "minute": self.minute,
            "weekdays": list(self.weekdays),
            "weekday_labels": self.weekday_labels,
            "time": self.time_label,
            "timezone": self.timezone,
            "description": self.description,
            "updated_at": self.updated_at,
            "updated_by": self.updated_by,
        }


def _env_hour() -> int:
    raw = (os.getenv("AUTO_AUTH_SCHEDULE_HOUR") or str(DEFAULT_HOUR)).strip()
    try:
        return int(raw)
    except ValueError:
        return DEFAULT_HOUR


def _env_minute() -> int:
    raw = (os.getenv("AUTO_AUTH_SCHEDULE_MINUTE") or str(DEFAULT_MINUTE)).strip()
    if ":" in raw:
        _, minute_part = raw.split(":", 1)
        raw = minute_part
    try:
        return int(raw)
    except ValueError:
        return DEFAULT_MINUTE


def default_settings() -> ScheduleSettings:
    return ScheduleSettings(
        hour=_env_hour(),
        minute=_env_minute(),
        weekdays=DEFAULT_WEEKDAYS,
        timezone=DEFAULT_TIMEZONE,
    )


def parse_weekdays_csv(raw: str) -> Tuple[int, ...]:
    values: List[int] = []
    for part in (raw or "").split(","):
        part = part.strip()
        if not part:
            continue
        try:
            day = int(part)
        except ValueError:
            continue
        if 0 <= day <= 6 and day not in values:
            values.append(day)
    return tuple(sorted(values))


def weekdays_to_csv(weekdays: List[int]) -> str:
    unique = sorted({int(d) for d in weekdays if 0 <= int(d) <= 6})
    if not unique:
        raise ValueError("At least one weekday is required")
    return ",".join(str(d) for d in unique)


def validate_schedule_input(hour: int, minute: int, weekdays: List[int]) -> None:
    if not (0 <= hour <= 23):
        raise ValueError("Hour must be between 0 and 23")
    if not (0 <= minute <= 59):
        raise ValueError("Minute must be between 0 and 59")
    if not weekdays_to_csv(weekdays):
        raise ValueError("At least one weekday is required")


def invalidate_cache() -> None:
    global _cached_settings
    with _cache_lock:
        _cached_settings = None


def get_schedule_settings(*, force_refresh: bool = False) -> ScheduleSettings:
    global _cached_settings
    with _cache_lock:
        if _cached_settings is not None and not force_refresh:
            return _cached_settings

    conn = get_db_connection()
    try:
        row = conn.execute(
            "SELECT hour, minute, weekdays, timezone, updated_at, updated_by FROM auto_auth_schedule_settings WHERE id = 1"
        ).fetchone()
    finally:
        conn.close()

    if not row:
        settings = default_settings()
    else:
        weekdays = parse_weekdays_csv(row["weekdays"])
        if not weekdays:
            weekdays = DEFAULT_WEEKDAYS
        settings = ScheduleSettings(
            hour=int(row["hour"]),
            minute=int(row["minute"]),
            weekdays=weekdays,
            timezone=row["timezone"] or DEFAULT_TIMEZONE,
            updated_at=row["updated_at"],
            updated_by=row["updated_by"],
        )

    with _cache_lock:
        _cached_settings = settings
    return settings


def update_schedule_settings(
    hour: int,
    minute: int,
    weekdays: List[int],
    updated_by: Optional[int],
) -> ScheduleSettings:
    validate_schedule_input(hour, minute, weekdays)
    weekdays_csv = weekdays_to_csv(weekdays)
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()

    conn = get_db_connection()
    try:
        conn.execute(
            """
            INSERT INTO auto_auth_schedule_settings (id, hour, minute, weekdays, timezone, updated_at, updated_by)
            VALUES (1, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                hour = excluded.hour,
                minute = excluded.minute,
                weekdays = excluded.weekdays,
                timezone = excluded.timezone,
                updated_at = excluded.updated_at,
                updated_by = excluded.updated_by
            """,
            (hour, minute, weekdays_csv, DEFAULT_TIMEZONE, now, updated_by),
        )
        conn.commit()
    finally:
        conn.close()

    invalidate_cache()
    return get_schedule_settings(force_refresh=True)
