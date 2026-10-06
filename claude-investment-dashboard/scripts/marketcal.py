"""NYSE trading-calendar helpers (standard library only).

Holidays are listed explicitly for 2025-2028. Extend NYSE_HOLIDAYS when the
NYSE publishes later years. Early-close days (1:00 p.m. ET) are treated as
normal sessions for date logic.
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
UTC = ZoneInfo("UTC")

NYSE_HOLIDAYS = {
    # 2025
    "2025-01-01", "2025-01-09", "2025-01-20", "2025-02-17", "2025-04-18", "2025-05-26",
    "2025-06-19", "2025-07-04", "2025-09-01", "2025-11-27", "2025-12-25",
    # 2026
    "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19",
    "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
    # 2027
    "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18",
    "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
    # 2028
    "2028-01-17", "2028-02-21", "2028-04-14", "2028-05-29", "2028-06-19", "2028-07-04",
    "2028-09-04", "2028-11-23", "2028-12-25",
}

REGULAR_OPEN = time(9, 30)
REGULAR_CLOSE = time(16, 0)
PREMARKET_OPEN = time(4, 0)
AFTER_HOURS_CLOSE = time(20, 0)


def is_trading_day(d: date) -> bool:
    return d.weekday() < 5 and d.isoformat() not in NYSE_HOLIDAYS


def next_trading_day_on_or_after(d: date) -> date:
    while not is_trading_day(d):
        d += timedelta(days=1)
    return d


def trading_days_between(start_exclusive: date, end_inclusive: date) -> int:
    n, d = 0, start_exclusive + timedelta(days=1)
    while d <= end_inclusive:
        if is_trading_day(d):
            n += 1
        d += timedelta(days=1)
    return n


def holiday_or_weekend_reason(d: date) -> str | None:
    if d.weekday() == 5:
        return "Saturday"
    if d.weekday() == 6:
        return "Sunday"
    if d.isoformat() in NYSE_HOLIDAYS:
        return "NYSE holiday"
    return None


def classify_session(ts_utc: datetime) -> dict:
    """Infer the trading session from a quote timestamp.

    Returns session_type in {regular_intraday, regular_close, premarket,
    after_hours, overnight_or_closed} and the ET session date. The data
    source does not flag sessions, so this is an inference from the timestamp.
    """
    et = ts_utc.astimezone(ET)
    d, t = et.date(), et.time()
    if not is_trading_day(d):
        stype = "overnight_or_closed"
    elif REGULAR_OPEN <= t < REGULAR_CLOSE:
        stype = "regular_intraday"
    elif t >= REGULAR_CLOSE and t < AFTER_HOURS_CLOSE:
        # Regular-session-only feeds report the 4:00 p.m. close with a
        # timestamp at or shortly after 16:00.
        stype = "regular_close"
    elif PREMARKET_OPEN <= t < REGULAR_OPEN:
        stype = "premarket"
    else:
        stype = "overnight_or_closed"
    return {"session_type": stype, "session_date": d.isoformat(), "quote_time_et": et.isoformat()}


def now_utc() -> datetime:
    return datetime.now(tz=UTC)
