"""Rate limits, the voice concurrency limit and caps through the API."""

from collections.abc import AsyncIterator

import httpx
import pytest
from fastapi import FastAPI

from tests.helpers import register


class Clock:
    def __init__(self) -> None:
        self.now = 1_000_000.0

    def __call__(self) -> float:
        return self.now


@pytest.fixture
def limiter_clock(app: FastAPI) -> Clock:
    clock = Clock()
    app.state.services.ratelimit.clock = clock
    return clock


@pytest.fixture
async def other_client(app: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=app, client=("198.51.100.9", 4321))
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as http:
        yield http


async def test_voice_token_hourly_limit(
    client: httpx.AsyncClient, other_client: httpx.AsyncClient, app: FastAPI, limiter_clock: Clock
) -> None:
    app.state.settings.max_concurrent_voice_sessions = 100
    for _ in range(10):
        assert (await client.get("/api/voice-token")).status_code == 200
    response = await client.get("/api/voice-token")
    assert response.status_code == 429
    error = response.json()["error"]
    assert error["code"] == "rate_limited"
    assert error["message"] == "Too many requests, try again in a minute."
    assert error["retry_after_seconds"] == 3600
    assert response.headers["retry-after"] == "3600"
    # Another IP has its own allowance.
    assert (await other_client.get("/api/voice-token")).status_code == 200


async def test_voice_token_daily_limit(
    client: httpx.AsyncClient, app: FastAPI, limiter_clock: Clock
) -> None:
    # 30 reservations would pass the $15 daily cap first; lift the caps to see the rate limit.
    app.state.settings.max_concurrent_voice_sessions = 100
    app.state.settings.budget_daily_usd = 1000
    app.state.settings.budget_total_usd = 1000
    for _ in range(3):
        for _ in range(10):
            assert (await client.get("/api/voice-token")).status_code == 200
        limiter_clock.now += 3601
    response = await client.get("/api/voice-token")
    assert response.status_code == 429
    assert response.json()["error"]["retry_after_seconds"] > 3600


async def test_pages_limit(client: httpx.AsyncClient, app: FastAPI, limiter_clock: Clock) -> None:
    limiter = app.state.services.ratelimit
    from app.logging import hash_ip
    from tests.conftest import CLIENT_IP

    for _ in range(120):
        limiter.hit("pages", hash_ip(CLIENT_IP))
    response = await client.post("/api/pages", json={"snapshot": {}})
    assert response.status_code == 429
    limiter_clock.now += 3601
    assert (await register(client, "offer"))["page_id"]


async def test_tool_buckets_are_separate(
    client: httpx.AsyncClient, app: FastAPI, limiter_clock: Clock
) -> None:
    for _ in range(30):
        assert (
            await client.post("/api/tools/site-trust", json={"url": "https://www.hdfcbank.com"})
        ).status_code == 200
    blocked = await client.post("/api/tools/site-trust", json={"url": "https://www.hdfcbank.com"})
    assert blocked.status_code == 429
    page = await register(client, "offer")
    loan = await client.post("/api/tools/loan-cost", json={"page_id": page["page_id"]})
    assert loan.status_code == 200


async def test_limiter_sweep_forgets_old_ips(app: FastAPI, limiter_clock: Clock) -> None:
    limiter = app.state.services.ratelimit
    limiter.hit("tools", "abc")
    limiter_clock.now += 3601
    limiter.sweep()
    assert limiter._hits == {}


async def test_voice_concurrency_limit(client: httpx.AsyncClient, app: FastAPI) -> None:
    for _ in range(6):
        assert (await client.get("/api/voice-token")).status_code == 200
    response = await client.get("/api/voice-token")
    assert response.status_code == 429
    error = response.json()["error"]
    assert error["code"] == "rate_limited"
    assert error["message"] == "Iris is busy right now. Please try again in a few minutes."


async def test_daily_cap_closes_voice_and_health(client: httpx.AsyncClient, app: FastAPI) -> None:
    ledger = app.state.services.ledger
    budget = app.state.services.budget
    await ledger.add_llm_call(budget.clock(), "claude-sonnet-5", "test", 0, 0, 0, 15.0)
    health = (await client.get("/api/health")).json()
    assert health["service"] == {"open": False, "reason": "daily_cap"}
    response = await client.get("/api/voice-token")
    assert response.status_code == 429
    error = response.json()["error"]
    assert error["code"] == "budget_exhausted_daily"
    assert error["message"] == "The demo has hit today's limit. Please try again tomorrow."
    assert error["retry_after_seconds"] > 0


async def test_lifetime_cap_closes_paid_tools(client: httpx.AsyncClient, app: FastAPI) -> None:
    page = await register(client, "privacy")
    ledger = app.state.services.ledger
    await ledger.add_llm_call(app.state.services.budget.clock(), "m", "test", 0, 0, 0, 200.0)
    response = await client.post(
        "/api/tools/summarize", json={"page_id": page["page_id"], "style": "quick"}
    )
    assert response.status_code == 503
    body = response.json()["error"]
    assert body["code"] == "service_closed"
    assert body["message"] == "The live demo is closed for now. You can still watch the video."
