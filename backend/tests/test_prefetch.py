"""ask_page starts a general question's web answer alongside the page model."""

import asyncio
import time
from typing import Any

import httpx

from app.services.tools.ask_page import adds_figures, looks_general
from tests.helpers import register

DELAY = 0.3


async def ask(client: httpx.AsyncClient, body: dict[str, Any]) -> dict[str, Any]:
    response = await client.post("/api/tools/ask-page", json=body)
    assert response.status_code == 200, response.text
    result: dict[str, Any] = response.json()
    return result


def slow(app) -> list[str]:  # type: ignore[no-untyped-def]
    """Every model call and search takes DELAY seconds; the searches are recorded."""
    llm = app.state.services.llm.complete
    search = app.state.services.search.provider.search
    queries: list[str] = []

    async def slow_llm(task):  # type: ignore[no-untyped-def]
        await asyncio.sleep(DELAY)
        return await llm(task)

    async def slow_search(query, *, max_results, topic):  # type: ignore[no-untyped-def]
        queries.append(query)
        await asyncio.sleep(DELAY)
        return await search(query, max_results=max_results, topic=topic)

    app.state.services.llm.complete = slow_llm
    app.state.services.search.provider.search = slow_search
    return queries


def test_which_questions_are_prefetched() -> None:
    assert looks_general("What does CIBIL mean?")
    assert looks_general("Is QuickCred registered with the RBI?")
    assert not looks_general("Is this charge normal?")  # needs the page for "this"
    assert not looks_general("Can I cancel anytime?")
    assert adds_figures("4% foreclosure charge typical India", "Is a foreclosure charge normal?")
    assert not adds_figures("CIBIL score meaning", "What does CIBIL mean?")


async def test_the_web_answer_runs_alongside_the_page_model(client: httpx.AsyncClient, app) -> None:  # type: ignore[no-untyped-def]
    page = await register(client, "terms")
    queries = slow(app)
    started = time.monotonic()
    result = await ask(client, {"page_id": page["page_id"], "question": "What does CIBIL mean?"})
    elapsed = time.monotonic() - started
    assert result["card"]["kind"] == "web_answer"
    assert queries == ["What does CIBIL mean?"]
    # One after another it would take the page model, the search and the web model: 3 × DELAY.
    assert elapsed < 2.6 * DELAY


async def test_a_page_answer_discards_the_prefetch(client: httpx.AsyncClient, app) -> None:  # type: ignore[no-untyped-def]
    page = await register(client, "terms")
    slow(app)
    result = await ask(
        client,
        {"page_id": page["page_id"], "question": "What is the late fee for a missed EMI?"},
    )
    assert result["card"]["kind"] == "answer"
    assert result["card"]["source"] == "page"


async def test_a_query_with_new_figures_is_searched_again(client: httpx.AsyncClient, app) -> None:  # type: ignore[no-untyped-def]
    from app.services.llm_tasks import AskPageAnswer

    original = app.state.services.llm.complete

    async def comparison(task):  # type: ignore[no-untyped-def]
        if task.name != "ask_page_answer":
            return await original(task)
        return AskPageAnswer(
            question_kind="comparison",
            web_query="4% foreclosure charge personal loan India typical",
            answer_type="not_on_page",
            say="The page doesn't say.",
            lead="Not on the page.",
            topic="Foreclosure",
            quote=None,
            related_risk_ids=[],
            agent_notes="",
        )

    app.state.services.llm.complete = comparison
    queries = slow(app)
    page = await register(client, "terms")
    result = await ask(
        client, {"page_id": page["page_id"], "question": "Is a foreclosure charge normal?"}
    )
    assert result["card"]["kind"] == "web_answer"
    assert queries[-1] == "4% foreclosure charge personal loan India typical"
