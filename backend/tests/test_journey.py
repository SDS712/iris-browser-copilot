"""A tab's journey: ask_page reads earlier pages, and the rolling summary (fake mode)."""

from typing import Any

import httpx

from tests.helpers import load_snapshot, register


async def ask(client: httpx.AsyncClient, body: dict[str, Any]) -> dict[str, Any]:
    response = await client.post("/api/tools/ask-page", json=body)
    assert response.status_code == 200, response.text
    result: dict[str, Any] = response.json()
    return result


def recording(app, seen: list[str]):  # type: ignore[no-untyped-def]
    """Wraps the fake LLM to record ask_page's page context."""
    original = app.state.services.llm.complete

    async def record(task):  # type: ignore[no-untyped-def]
        if task.name == "ask_page_answer":
            seen.append(str(task.messages[1]["content"]))
        return await original(task)

    app.state.services.llm.complete = record


async def test_answers_from_an_earlier_page(client: httpx.AsyncClient) -> None:
    terms = await register(client, "terms")
    form = await register(client, "form")
    result = await ask(
        client,
        {
            "page_id": form["page_id"],
            "question": "Can I cancel QuickCred Plus anytime?",
            "earlier_page_ids": [terms["page_id"]],
        },
    )
    quote = result["card"]["quote"]
    assert quote["page_title"] == "QuickCred Loan Agreement: Terms and Conditions"
    assert quote["page_url"].endswith("/demo/terms?ref=checkout&utm_source=mail")
    assert quote["section_heading"] == "7.2 Cancellation"
    # Not on screen, so nothing to highlight or mark.
    assert result["highlight_ids"] == []
    assert result["quote_text"] is None


async def test_the_current_page_keeps_its_answers(client: httpx.AsyncClient, app) -> None:  # type: ignore[no-untyped-def]
    seen: list[str] = []
    recording(app, seen)
    terms = await register(client, "terms")
    form = await register(client, "form")
    result = await ask(
        client,
        {
            "page_id": terms["page_id"],
            "question": "Is there a foreclosure charge?",
            "earlier_page_ids": [form["page_id"]],
        },
    )
    assert result["card"]["quote"]["page_title"] is None
    assert result["highlight_ids"] == [result["card"]["quote"]["section_id"]]
    # The form doesn't match the question, so none of its text was read.
    assert seen[0].endswith("EARLIER PAGES IN THIS TAB:\n(none)")


async def test_a_named_earlier_page_is_read(client: httpx.AsyncClient, app) -> None:  # type: ignore[no-untyped-def]
    seen: list[str] = []
    recording(app, seen)
    offer = await register(client, "offer")
    terms = await register(client, "terms")
    await ask(
        client,
        {
            "page_id": terms["page_id"],
            "question": "What did the Nimbus page say?",
            "earlier_page_ids": [offer["page_id"]],
        },
    )
    assert "PAGE p1: QuickCred – Own the Nimbus 14 today" in seen[0]
    assert "[p1:s-" in seen[0]


async def test_gone_and_repeated_earlier_pages_are_skipped(client: httpx.AsyncClient) -> None:
    terms = await register(client, "terms")
    result = await ask(
        client,
        {
            "page_id": terms["page_id"],
            "question": "Can I cancel QuickCred Plus anytime?",
            "earlier_page_ids": ["pg_gone", terms["page_id"]],
        },
    )
    assert result["card"]["quote"]["page_title"] is None


async def test_at_most_nine_earlier_pages(client: httpx.AsyncClient) -> None:
    terms = await register(client, "terms")
    body = {"page_id": terms["page_id"], "question": "Q?", "earlier_page_ids": ["pg_x"] * 10}
    response = await client.post("/api/tools/ask-page", json=body)
    assert response.status_code == 400


async def test_journey_summary(client: httpx.AsyncClient, app) -> None:  # type: ignore[no-untyped-def]
    body = {
        "facts": [
            "QuickCred – Own the Nimbus 14 today (offer, iris.example.com): ₹59,999; 1.5% a month",
            "Checkout (checkout, iris.example.com): Total ₹5,949",
        ],
        "previous_summary": "Earlier: a search for laptops.",
    }
    response = await client.post("/api/journey/summary", json=body)
    assert response.status_code == 200
    result = response.json()
    assert result["contract_version"] == 1
    assert result["summary"].startswith("Earlier: a search for laptops. QuickCred")
    assert len(result["summary"]) <= 1200
    assert await app.state.services.ledger.llm_spend_since(0) > 0


async def test_journey_summary_limits(client: httpx.AsyncClient) -> None:
    too_many = await client.post("/api/journey/summary", json={"facts": ["x"] * 11})
    assert too_many.status_code == 400
    empty = await client.post("/api/journey/summary", json={"facts": []})
    assert empty.status_code == 400
    too_long = await client.post("/api/journey/summary", json={"facts": ["x" * 601]})
    assert too_long.status_code == 400


async def test_a_small_earlier_page_is_read_by_shared_words(client: httpx.AsyncClient) -> None:
    cart = load_snapshot("checkout")
    cart.update(
        title="Your cart",
        url="https://iris.example.com/demo/cart",
        sections=[
            {"id": "s-1", "heading": "Your cart", "level": 1, "text": "Travel backpack ₹2,299"},
            {
                "id": "s-2",
                "heading": "Gift messages",
                "level": 2,
                "text": "Gift messages can be up to 200 characters long.",
            },
        ],
    )
    earlier = await register(client, cart)
    terms = await register(client, "terms")
    result = await ask(
        client,
        {
            "page_id": terms["page_id"],
            "question": "How long can a gift message be?",
            "earlier_page_ids": [earlier["page_id"]],
        },
    )
    assert result["card"]["quote"]["page_title"] == "Your cart"
