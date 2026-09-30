"""Spend caps: reservations, daily and lifetime caps, the Kolkata day boundary, the kill
switch, the pre-call estimate, and the AssemblyAI sessions sync (respx)."""

import logging
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from pathlib import Path

import httpx
import pytest
import respx

from app.errors import IrisError
from app.services.assemblyai import AGENTS_BASE_URL, AssemblyAIVoiceClient, agents_http_client
from app.services.budget import Budget, Ledger, VoiceSessionSync
from app.settings import Settings


def ts(text: str) -> float:
    return datetime.fromisoformat(text).timestamp()


class Clock:
    def __init__(self, start: str) -> None:
        self.now = ts(start)

    def __call__(self) -> float:
        return self.now


@pytest.fixture
def clock() -> Clock:
    # 2026-09-27 11:30 in Kolkata (UTC+5:30).
    return Clock("2026-09-27T06:00:00+00:00")


@pytest.fixture
async def budget(tmp_path: Path, clock: Clock) -> AsyncIterator[Budget]:
    ledger = Ledger(tmp_path / "iris.db")
    await ledger.open()
    settings = Settings(_env_file=None, iris_env="test", data_dir=tmp_path)  # type: ignore[call-arg]
    yield Budget(ledger, settings, clock=clock)
    await ledger.close()


async def spend_llm(budget: Budget, cost: float, at: float | None = None) -> None:
    await budget.ledger.add_llm_call(
        at if at is not None else budget.clock(), "claude-haiku-4-5-20251001", "test", 0, 0, 0, cost
    )


async def test_open_by_default(budget: Budget) -> None:
    status = await budget.status()
    assert (status.open, status.reason) == (True, None)
    await budget.check()


async def test_reservation_counts_until_its_window_ends(budget: Budget, clock: Clock) -> None:
    await budget.reserve_voice()
    assert (await budget.spend()).today_usd == pytest.approx(0.75)
    assert await budget.voice_sessions_in_flight() == 1
    clock.now += 600 + 1
    assert await budget.voice_sessions_in_flight() == 0
    assert (await budget.spend()).today_usd == pytest.approx(0.75)  # still inside +120 s
    clock.now += 120
    assert (await budget.spend()).today_usd == 0


async def test_daily_cap(budget: Budget, clock: Clock) -> None:
    await spend_llm(budget, 15.0)
    with pytest.raises(IrisError) as caught:
        await budget.check()
    assert caught.value.code == "budget_exhausted_daily"
    # 11:30 in Kolkata → 12.5 hours to midnight.
    assert caught.value.retry_after_seconds == 12 * 3600 + 30 * 60
    status = await budget.status()
    assert (status.open, status.reason) == (False, "daily_cap")


async def test_day_boundary_is_midnight_in_kolkata(budget: Budget, clock: Clock) -> None:
    # 23:50 on the 26th in Kolkata is 18:20 UTC; midnight is 18:30 UTC.
    await spend_llm(budget, 10.0, at=ts("2026-09-26T18:20:00+00:00"))
    clock.now = ts("2026-09-26T18:25:00+00:00")
    assert (await budget.spend()).today_usd == pytest.approx(10.0)
    clock.now = ts("2026-09-26T18:35:00+00:00")
    spend = await budget.spend()
    assert spend.today_usd == 0
    assert spend.total_usd == pytest.approx(10.0)


async def test_spend_before_the_start_date_is_ignored(budget: Budget) -> None:
    await spend_llm(budget, 50.0, at=ts("2026-09-20T12:00:00+00:00"))
    assert (await budget.spend()).total_usd == 0


async def test_lifetime_cap(budget: Budget, clock: Clock) -> None:
    for day in range(9):
        await spend_llm(budget, 14.5, at=ts(f"2026-09-{26 + day % 4:02d}T10:00:00+00:00"))
    clock.now = ts("2026-09-30T10:00:00+00:00")
    with pytest.raises(IrisError) as caught:
        await budget.check()
    assert caught.value.code == "service_closed"
    assert (await budget.status()).reason == "total_cap"


async def test_kill_switch_comes_first(budget: Budget) -> None:
    budget.settings.kill_switch = True
    with pytest.raises(IrisError) as caught:
        await budget.check()
    assert caught.value.code == "service_closed"
    assert (await budget.status()).reason == "paused"


async def test_pre_call_estimate_is_refused(budget: Budget) -> None:
    await spend_llm(budget, 14.99)
    await budget.check()
    with pytest.raises(IrisError) as caught:
        await budget.check(estimate_usd=0.02)
    assert caught.value.code == "budget_exhausted_daily"


async def test_warnings_at_80_percent(budget: Budget, caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.WARNING, logger="iris.budget")
    await spend_llm(budget, 12.5)
    await budget.spend()
    await budget.spend()
    messages = [record.getMessage() for record in caplog.records]
    assert messages.count("daily spend passed 80% of the cap") == 1


async def test_search_credits_by_calendar_month(budget: Budget, clock: Clock) -> None:
    await budget.ledger.add_search_call(ts("2026-08-31T23:00:00+00:00"), 1)
    await budget.record_search()
    await budget.record_search()
    assert await budget.search_credits_this_month() == 2


# --- Sessions sync ---

SESSIONS_URL = f"{AGENTS_BASE_URL}/v1/sessions"


def session(sid: str, created: str, ended: str | None, duration: float | None) -> dict[str, object]:
    return {
        "id": sid,
        "status": "completed" if ended else "active",
        "duration_seconds": duration,
        "created_at": created,
        "ended_at": ended,
    }


@respx.mock
async def test_sessions_sync_follows_cursor_and_stops_at_start(
    budget: Budget, clock: Clock
) -> None:
    pages = [
        {
            "sessions": [
                session("sess_running", "2026-09-27T05:57:00Z", None, None),
                session("sess_done", "2026-09-27T05:00:00.607110Z", "2026-09-27T05:05:00Z", 300.0),
            ],
            "has_more": True,
            "response_metadata": {"next_cursor": "cursor-2"},
        },
        {
            "sessions": [
                session("sess_long", "2026-09-26T08:00:00Z", "2026-09-26T08:30:00Z", 1800.0),
                session("sess_old", "2026-09-25T08:00:00Z", "2026-09-25T08:05:00Z", 300.0),
            ],
            "has_more": True,
            "response_metadata": {"next_cursor": "cursor-3"},
        },
    ]
    route = respx.get(SESSIONS_URL).mock(
        side_effect=[httpx.Response(200, json=page) for page in pages]
    )
    http = agents_http_client("test-key")
    sync = VoiceSessionSync(AssemblyAIVoiceClient(http), budget)
    assert await sync.sync() == 3
    await http.aclose()

    assert route.call_count == 2  # stopped at the session before BUDGET_START_DATE
    first, second = route.calls[0].request, route.calls[1].request
    assert first.headers["authorization"] == "Bearer test-key"
    assert first.url.params["limit"] == "200"
    assert "cursor" not in first.url.params
    assert second.url.params["cursor"] == "cursor-2"

    async with budget.ledger.db.execute(
        "SELECT id, duration_seconds, cost_usd FROM voice_sessions ORDER BY id"
    ) as cursor:
        rows = await cursor.fetchall()
    assert rows == [
        ("sess_done", 300.0, pytest.approx(0.375)),
        ("sess_long", 1800.0, pytest.approx(2.25)),
        ("sess_running", 180.0, pytest.approx(0.225)),  # running: now − created_at
    ]


@respx.mock
async def test_sync_is_idempotent_and_caps_running_sessions(budget: Budget, clock: Clock) -> None:
    body = {
        "sessions": [session("sess_x", "2026-09-27T04:00:00Z", None, None)],
        "has_more": False,
        "response_metadata": {},
    }
    respx.get(SESSIONS_URL).mock(return_value=httpx.Response(200, json=body))
    http = agents_http_client("test-key")
    sync = VoiceSessionSync(AssemblyAIVoiceClient(http), budget)
    await sync.sync()
    await sync.sync()
    await http.aclose()
    spend = await budget.ledger.session_spend_since(0)
    assert spend == pytest.approx(0.75)  # capped at 600 s, counted once


@respx.mock
async def test_sync_if_stale(budget: Budget, clock: Clock) -> None:
    route = respx.get(SESSIONS_URL).mock(
        return_value=httpx.Response(200, json={"sessions": [], "has_more": False})
    )
    http = agents_http_client("test-key")
    sync = VoiceSessionSync(AssemblyAIVoiceClient(http), budget)
    await sync.sync_if_stale()
    await sync.sync_if_stale()
    assert route.call_count == 1
    clock.now += 121
    await sync.sync_if_stale()
    assert route.call_count == 2
    route.mock(return_value=httpx.Response(500))
    clock.now += 121
    await sync.sync_if_stale()  # a failed sync is logged, never raised
    await http.aclose()


async def test_synced_sessions_count_towards_the_caps(budget: Budget) -> None:
    started = datetime(2026, 9, 27, 4, 0, tzinfo=UTC).timestamp()
    await budget.ledger.upsert_voice_session("sess_big", started, started + 7200, 7200, 9.0, 0)
    await spend_llm(budget, 6.0)
    with pytest.raises(IrisError):
        await budget.check()
