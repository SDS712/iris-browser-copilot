"""Spend ledger and caps.

The ledger must never under-count: when unsure, it counts more.
"""

import asyncio
import logging
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from datetime import time as dtime
from pathlib import Path
from typing import Literal
from zoneinfo import ZoneInfo

import aiosqlite

from app.errors import ErrorCode, IrisError
from app.pricing import VOICE_USD_PER_SECOND, voice_cost_usd
from app.services.assemblyai import VoiceClient
from app.settings import Settings

logger = logging.getLogger("iris.budget")

SCHEMA = """
CREATE TABLE IF NOT EXISTS llm_calls (
    id INTEGER PRIMARY KEY,
    ts REAL NOT NULL,
    model TEXT NOT NULL,
    purpose TEXT NOT NULL,
    prompt_tokens INTEGER NOT NULL,
    cached_tokens INTEGER NOT NULL,
    completion_tokens INTEGER NOT NULL,
    cost_usd REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS llm_calls_ts ON llm_calls (ts);
CREATE TABLE IF NOT EXISTS voice_reservations (
    id INTEGER PRIMARY KEY,
    ts REAL NOT NULL,
    reserved_usd REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS voice_reservations_ts ON voice_reservations (ts);
CREATE TABLE IF NOT EXISTS voice_sessions (
    id TEXT PRIMARY KEY,
    created_at REAL NOT NULL,
    ended_at REAL,
    duration_seconds REAL NOT NULL,
    cost_usd REAL NOT NULL,
    synced_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS voice_sessions_created ON voice_sessions (created_at);
CREATE TABLE IF NOT EXISTS search_calls (
    id INTEGER PRIMARY KEY,
    ts REAL NOT NULL,
    credits INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS search_calls_ts ON search_calls (ts);
"""


class Ledger:
    """SQLite spend ledger in DATA_DIR/iris.db. Timestamps are Unix seconds (UTC)."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self._db: aiosqlite.Connection | None = None

    @property
    def db(self) -> aiosqlite.Connection:
        if self._db is None:
            raise RuntimeError("ledger is not open")
        return self._db

    async def open(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._db = await aiosqlite.connect(self.path)
        await self._db.executescript(SCHEMA)
        await self._db.commit()

    async def close(self) -> None:
        if self._db is not None:
            await self._db.close()
            self._db = None

    async def _sum(self, sql: str, *params: float) -> float:
        async with self.db.execute(sql, params) as cursor:
            row = await cursor.fetchone()
        return float(row[0]) if row and row[0] is not None else 0.0

    async def add_llm_call(
        self,
        ts: float,
        model: str,
        purpose: str,
        prompt_tokens: int,
        cached_tokens: int,
        completion_tokens: int,
        cost_usd: float,
    ) -> None:
        await self.db.execute(
            "INSERT INTO llm_calls (ts, model, purpose, prompt_tokens, cached_tokens,"
            " completion_tokens, cost_usd) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (ts, model, purpose, prompt_tokens, cached_tokens, completion_tokens, cost_usd),
        )
        await self.db.commit()

    async def add_voice_reservation(self, ts: float, reserved_usd: float) -> None:
        await self.db.execute(
            "INSERT INTO voice_reservations (ts, reserved_usd) VALUES (?, ?)", (ts, reserved_usd)
        )
        await self.db.commit()

    async def add_search_call(self, ts: float, credits: int) -> None:
        await self.db.execute("INSERT INTO search_calls (ts, credits) VALUES (?, ?)", (ts, credits))
        await self.db.commit()

    async def upsert_voice_session(
        self,
        session_id: str,
        created_at: float,
        ended_at: float | None,
        duration_seconds: float,
        cost_usd: float,
        synced_at: float,
    ) -> None:
        await self.db.execute(
            "INSERT INTO voice_sessions (id, created_at, ended_at, duration_seconds, cost_usd,"
            " synced_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET"
            " ended_at = excluded.ended_at, duration_seconds = excluded.duration_seconds,"
            " cost_usd = excluded.cost_usd, synced_at = excluded.synced_at",
            (session_id, created_at, ended_at, duration_seconds, cost_usd, synced_at),
        )
        await self.db.commit()

    async def llm_spend_since(self, since: float) -> float:
        return await self._sum("SELECT SUM(cost_usd) FROM llm_calls WHERE ts >= ?", since)

    async def session_spend_since(self, since: float) -> float:
        return await self._sum(
            "SELECT SUM(cost_usd) FROM voice_sessions WHERE created_at >= ?", since
        )

    async def reserved_since(self, since: float) -> float:
        return await self._sum(
            "SELECT SUM(reserved_usd) FROM voice_reservations WHERE ts >= ?", since
        )

    async def reservation_count_since(self, since: float) -> int:
        return int(await self._sum("SELECT COUNT(*) FROM voice_reservations WHERE ts >= ?", since))

    async def search_credits_since(self, since: float) -> int:
        return int(await self._sum("SELECT SUM(credits) FROM search_calls WHERE ts >= ?", since))


Reason = Literal["daily_cap", "total_cap", "paused"]


@dataclass(frozen=True)
class Spend:
    today_usd: float
    total_usd: float


@dataclass(frozen=True)
class ServiceStatus:
    open: bool
    reason: Reason | None
    retry_after_seconds: int | None = None


class Budget:
    """Daily cap in BUDGET_TZ and lifetime cap since BUDGET_START_DATE."""

    def __init__(
        self, ledger: Ledger, settings: Settings, clock: Callable[[], float] = time.time
    ) -> None:
        self.ledger = ledger
        self.settings = settings
        self.clock = clock
        self.tz = ZoneInfo(settings.budget_tz)
        self._warned_day: date | None = None
        self._warned_total = False

    # --- Time windows ---

    def _local_midnight(self, day: date) -> float:
        return datetime.combine(day, dtime.min, tzinfo=self.tz).timestamp()

    def day_start(self, now: float) -> float:
        return self._local_midnight(datetime.fromtimestamp(now, self.tz).date())

    def seconds_until_midnight(self, now: float) -> int:
        tomorrow = datetime.fromtimestamp(now, self.tz).date() + timedelta(days=1)
        return max(1, int(self._local_midnight(tomorrow) - now + 0.999))

    def start_ts(self) -> float:
        return self._local_midnight(self.settings.budget_start_date)

    def voice_reservation_usd(self) -> float:
        return self.settings.voice_max_session_seconds * VOICE_USD_PER_SECOND

    # --- Totals ---

    async def _spend_since(self, since: float, reservations_from: float) -> float:
        return (
            await self.ledger.llm_spend_since(since)
            + await self.ledger.session_spend_since(since)
            + await self.ledger.reserved_since(max(since, reservations_from))
        )

    async def spend(self) -> Spend:
        now = self.clock()
        start = self.start_ts()
        # Recent reservations cover sessions the sync hasn't seen yet. A session can be
        # counted twice for a short while, which errs on the safe side for a cap.
        reservations_from = now - (self.settings.voice_max_session_seconds + 120)
        today = await self._spend_since(max(self.day_start(now), start), reservations_from)
        total = await self._spend_since(start, reservations_from)
        self._maybe_warn(now, today, total)
        return Spend(today_usd=today, total_usd=total)

    def _maybe_warn(self, now: float, today: float, total: float) -> None:
        day = datetime.fromtimestamp(now, self.tz).date()
        if today >= 0.8 * self.settings.budget_daily_usd and self._warned_day != day:
            self._warned_day = day
            logger.warning(
                "daily spend passed 80% of the cap",
                extra={
                    "iris": {
                        "today_usd": round(today, 4),
                        "cap_usd": self.settings.budget_daily_usd,
                    }
                },
            )
        if total >= 0.8 * self.settings.budget_total_usd and not self._warned_total:
            self._warned_total = True
            logger.warning(
                "total spend passed 80% of the lifetime cap",
                extra={
                    "iris": {
                        "total_usd": round(total, 4),
                        "cap_usd": self.settings.budget_total_usd,
                    }
                },
            )

    async def status(self, estimate_usd: float = 0.0) -> ServiceStatus:
        if self.settings.kill_switch:
            return ServiceStatus(open=False, reason="paused")
        spend = await self.spend()
        if spend.total_usd >= self.settings.budget_total_usd or (
            estimate_usd > 0 and spend.total_usd + estimate_usd > self.settings.budget_total_usd
        ):
            return ServiceStatus(open=False, reason="total_cap")
        if spend.today_usd >= self.settings.budget_daily_usd or (
            estimate_usd > 0 and spend.today_usd + estimate_usd > self.settings.budget_daily_usd
        ):
            return ServiceStatus(
                open=False,
                reason="daily_cap",
                retry_after_seconds=self.seconds_until_midnight(self.clock()),
            )
        return ServiceStatus(open=True, reason=None)

    async def check(self, estimate_usd: float = 0.0) -> None:
        """Raise if the service is closed, or if a call costing estimate_usd would pass a cap."""
        status = await self.status(estimate_usd)
        if status.reason in ("paused", "total_cap"):
            raise IrisError(ErrorCode.SERVICE_CLOSED)
        if status.reason == "daily_cap":
            raise IrisError(
                ErrorCode.BUDGET_EXHAUSTED_DAILY, retry_after_seconds=status.retry_after_seconds
            )

    # --- Recording ---

    async def record_llm_call(
        self,
        model: str,
        purpose: str,
        prompt_tokens: int,
        cached_tokens: int,
        completion_tokens: int,
        cost_usd: float,
    ) -> None:
        await self.ledger.add_llm_call(
            self.clock(), model, purpose, prompt_tokens, cached_tokens, completion_tokens, cost_usd
        )

    async def reserve_voice(self) -> None:
        await self.ledger.add_voice_reservation(self.clock(), self.voice_reservation_usd())

    async def voice_sessions_in_flight(self) -> int:
        """Reservations made within the last session length: sessions that may still be running."""
        since = self.clock() - self.settings.voice_max_session_seconds
        return await self.ledger.reservation_count_since(since)

    async def record_search(self, credits: int = 1) -> None:
        await self.ledger.add_search_call(self.clock(), credits)

    async def search_credits_this_month(self) -> int:
        now = datetime.fromtimestamp(self.clock(), tz=ZoneInfo("UTC"))
        month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        return await self.ledger.search_credits_since(month_start.timestamp())


SYNC_INTERVAL_SECONDS = 120
MAX_SYNC_PAGES = 50


class VoiceSessionSync:
    """Actual voice usage from AssemblyAI's sessions list.

    Counts every session on the account, playground tests included: that's what
    protects the credits.
    """

    def __init__(self, voice: VoiceClient, budget: Budget) -> None:
        self.voice = voice
        self.budget = budget
        self.last_sync: float | None = None
        self._lock = asyncio.Lock()

    async def sync(self) -> int:
        async with self._lock:
            settings = self.budget.settings
            start = self.budget.start_ts()
            now = self.budget.clock()
            cursor: str | None = None
            synced = 0
            for _ in range(MAX_SYNC_PAGES):
                page = await self.voice.list_sessions(cursor)
                reached_start = False
                for session in page.sessions:
                    created = session.created_at.timestamp()
                    if created < start:
                        reached_start = True  # newest first: everything after is older
                        break
                    ended = session.ended_at.timestamp() if session.ended_at else None
                    if ended is None:
                        # Still running: count it as running until now, up to the session cap.
                        elapsed = max(now - created, session.duration_seconds or 0.0)
                        duration = min(elapsed, float(settings.voice_max_session_seconds))
                    elif session.duration_seconds is not None:
                        duration = session.duration_seconds
                    else:
                        duration = max(ended - created, 0.0)
                    await self.budget.ledger.upsert_voice_session(
                        session.id, created, ended, duration, voice_cost_usd(duration), now
                    )
                    synced += 1
                if reached_start or page.next_cursor is None:
                    break
                cursor = page.next_cursor
            self.last_sync = now
            logger.info("voice sessions synced", extra={"iris": {"sessions": synced}})
            return synced

    async def sync_if_stale(self) -> None:
        """Before minting a token: refresh if the last sync is over 120 seconds old."""
        if self.last_sync is not None and (
            self.budget.clock() - self.last_sync <= SYNC_INTERVAL_SECONDS
        ):
            return
        try:
            await self.sync()
        except Exception:
            # Recent reservations still cover new sessions, so minting can go ahead.
            logger.warning("voice session sync failed", extra={"iris": {"upstream": "assemblyai"}})
