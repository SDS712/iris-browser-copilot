"""Search: Tavily request shape (respx), credits, the monthly limit and the cache."""

import json
from collections.abc import AsyncIterator
from pathlib import Path

import httpx
import pytest
import respx

from app.errors import IrisError
from app.services.budget import Budget, Ledger
from app.services.fakes.search import FakeSearch
from app.services.search import TAVILY_URL, SearchService, TavilySearch, tavily_http_client
from app.settings import Settings


@pytest.fixture
async def budget(tmp_path: Path) -> AsyncIterator[Budget]:
    ledger = Ledger(tmp_path / "iris.db")
    await ledger.open()
    yield Budget(ledger, Settings(_env_file=None, iris_env="test", data_dir=tmp_path))  # type: ignore[call-arg]
    await ledger.close()


@respx.mock
async def test_tavily_request_and_parsing() -> None:
    route = respx.post(TAVILY_URL).mock(
        return_value=httpx.Response(
            200,
            json={
                "results": [
                    {
                        "title": "NACH explained",
                        "url": "https://www.npci.org.in/nach",
                        "content": "NACH is…",
                        "score": 0.8,
                    },
                    {"title": "Bad", "url": "ftp://nope", "content": "", "score": 0.1},
                ]
            },
        )
    )
    http = tavily_http_client("tvly-test")
    hits = await TavilySearch(http).search("what is NACH", max_results=5, topic="general")
    await http.aclose()
    request = route.calls.last.request
    assert request.headers["authorization"] == "Bearer tvly-test"
    assert json.loads(request.content) == {
        "query": "what is NACH",
        "search_depth": "basic",
        "topic": "general",
        "max_results": 5,
        "include_answer": False,
        "include_raw_content": False,
    }
    assert len(hits) == 1
    assert hits[0].domain == "npci.org.in"
    assert hits[0].source().model_dump() == {
        "title": "NACH explained",
        "url": "https://www.npci.org.in/nach",
        "domain": "npci.org.in",
    }


@respx.mock
async def test_tavily_failure_is_unavailable(budget: Budget) -> None:
    respx.post(TAVILY_URL).mock(return_value=httpx.Response(500))
    http = tavily_http_client("tvly-test")
    service = SearchService(TavilySearch(http), budget, budget.settings)
    with pytest.raises(IrisError) as caught:
        await service.search("anything")
    await http.aclose()
    assert caught.value.code == "upstream_error"
    assert caught.value.agent_message == (
        "Web search is unavailable right now. Tell the user you can't look that up at the moment."
    )


async def test_credits_and_cache(budget: Budget) -> None:
    service = SearchService(FakeSearch(), budget, budget.settings)
    first = await service.search("What is  CKYC")
    second = await service.search("what is ckyc")
    assert first == second
    assert await budget.search_credits_this_month() == 1


async def test_monthly_limit_refuses_search(budget: Budget) -> None:
    budget.settings.search_monthly_credit_limit = 2
    service = SearchService(FakeSearch(), budget, budget.settings)
    await service.search("one")
    await service.search("two")
    with pytest.raises(IrisError) as caught:
        await service.search("three")
    assert caught.value.code == "upstream_error"
    assert "unavailable" in caught.value.agent_message


async def test_search_respects_kill_switch(budget: Budget) -> None:
    budget.settings.kill_switch = True
    service = SearchService(FakeSearch(), budget, budget.settings)
    with pytest.raises(IrisError) as caught:
        await service.search("anything")
    assert caught.value.code == "service_closed"
