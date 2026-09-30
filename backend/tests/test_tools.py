"""Page tools through the API in fake mode: ask_page, explain_field, summarize, scan."""

from typing import Any

import httpx

from tests.helpers import load_snapshot, ready_scan, register


async def call(client: httpx.AsyncClient, tool: str, body: dict[str, Any]) -> httpx.Response:
    return await client.post(f"/api/tools/{tool}", json=body)


async def test_ask_page_answers_from_the_clause(client: httpx.AsyncClient) -> None:
    page = await register(client, "terms")
    response = await call(
        client,
        "ask-page",
        {"page_id": page["page_id"], "question": "Can I cancel QuickCred Plus anytime?"},
    )
    assert response.status_code == 200
    result = response.json()
    assert result["contract_version"] == 1
    assert result["not_found"] is False
    card = result["card"]
    assert card["kind"] == "answer"
    assert card["source"] == "page"
    assert card["topic"] == "Cancellation"
    assert card["quote"]["section_heading"] == "7.2 Cancellation"
    assert "30 days' written notice" in card["quote"]["text"]
    assert result["quote_text"] == card["quote"]["text"]
    assert result["highlight_ids"] == [card["quote"]["section_id"]]
    assert result["say"].startswith("The page says: You may cancel QuickCred Plus")
    assert result["sources"] == []


async def test_ask_page_not_on_page(client: httpx.AsyncClient) -> None:
    page = await register(client, "terms")
    result = (
        await call(
            client,
            "ask-page",
            {"page_id": page["page_id"], "question": "What's the weather in Paris?"},
        )
    ).json()
    assert result["not_found"] is True
    assert result["card"]["source"] == "not_found"
    assert result["say"].startswith("The page doesn't")
    assert result["highlight_ids"] == []


async def test_ask_page_unverified_quote_becomes_not_found(client: httpx.AsyncClient, app) -> None:  # type: ignore[no-untyped-def]
    from app.services.llm_tasks import AskPageAnswer, QuoteRef

    async def invented(task):  # type: ignore[no-untyped-def]
        return AskPageAnswer(
            answer_type="from_page",
            say="Yes, anytime, for free.",
            lead="Free to cancel.",
            topic="Cancellation",
            quote=QuoteRef(section_id="s-19", text="Cancel anytime for free."),
            related_risk_ids=[],
            agent_notes="",
            question_kind="this_company",
            web_query=None,
        )

    app.state.services.llm.complete = invented
    page = await register(client, "offer")
    result = (
        await call(client, "ask-page", {"page_id": page["page_id"], "question": "Free to cancel?"})
    ).json()
    assert result["not_found"] is True
    assert result["say"] == "The page doesn't clearly say that. Want me to look it up?"
    assert result["card"]["quote"] is None


async def test_ask_page_looks_up_general_questions(client: httpx.AsyncClient, app) -> None:  # type: ignore[no-untyped-def]
    page = await register(client, "terms")
    question = "What does CIBIL mean?"
    body = {"page_id": page["page_id"], "question": question}
    result = (await call(client, "ask-page", body)).json()
    assert result["not_found"] is False
    assert result["say"].startswith("That isn't on the page, so I looked it up.")
    assert result["card"]["kind"] == "web_answer"
    assert result["sources"]
    assert await app.state.services.ledger.search_credits_since(0) == 1


async def test_ask_page_offers_before_searching_for_the_sites_own_terms(
    client: httpx.AsyncClient, app
) -> None:  # type: ignore[no-untyped-def]
    page = await register(client, "terms")
    body = {"page_id": page["page_id"], "question": "What's the weather in Paris?"}
    result = (await call(client, "ask-page", body)).json()
    assert result["say"] == "The page doesn't mention that. Want me to look it up?"
    assert await app.state.services.ledger.search_credits_since(0) == 0


async def test_ask_page_says_when_the_web_has_nothing(client: httpx.AsyncClient, app) -> None:  # type: ignore[no-untyped-def]
    async def nothing(query, *, max_results, topic):  # type: ignore[no-untyped-def]
        return []

    app.state.services.search.provider.search = nothing
    page = await register(client, "terms")
    body = {"page_id": page["page_id"], "question": "What does CIBIL mean?"}
    result = (await call(client, "ask-page", body)).json()
    assert result["not_found"] is True
    assert result["say"] == (
        "The page doesn't mention that. I couldn't find a clear answer online either."
    )


async def test_ask_page_when_search_is_down(client: httpx.AsyncClient, app) -> None:  # type: ignore[no-untyped-def]
    app.state.settings.search_monthly_credit_limit = 0
    page = await register(client, "terms")
    body = {"page_id": page["page_id"], "question": "What does CIBIL mean?"}
    result = (await call(client, "ask-page", body)).json()
    assert result["not_found"] is True
    assert result["say"] == "The page doesn't mention that. I can't search the web just now."


async def test_is_this_normal_searches_even_if_page_says(client: httpx.AsyncClient, app) -> None:  # type: ignore[no-untyped-def]
    page = await register(client, "terms")
    body = {
        "page_id": page["page_id"],
        "question": "Is this charge normal?",
        "pointer": {"section_id": "s-16"},
    }
    result = (await call(client, "ask-page", body)).json()
    assert result["card"]["kind"] == "web_answer"
    assert await app.state.services.ledger.search_credits_since(0) == 1


async def test_ask_page_answers_about_what_the_user_points_at(client: httpx.AsyncClient) -> None:
    page = await register(client, "terms")
    body = {
        "page_id": page["page_id"],
        "question": "What does this mean?",
        "pointer": {"section_id": "s-16"},
    }
    result = (await call(client, "ask-page", body)).json()
    assert result["card"]["quote"]["section_heading"] == "6.2 Foreclosure charge"
    assert result["highlight_ids"] == ["s-16"]


async def test_ask_page_tells_the_model_what_the_user_points_at(
    client: httpx.AsyncClient, app
) -> None:  # type: ignore[no-untyped-def]
    from app.services.llm_tasks import AskPageAnswer

    seen: list[str] = []
    original = app.state.services.llm.complete

    async def record(task):  # type: ignore[no-untyped-def]
        if task.name != "ask_page_answer":
            return await original(task)
        seen.append("\n".join(str(message["content"]) for message in task.messages))
        return AskPageAnswer(
            answer_type="not_on_page",
            say="The page doesn't say.",
            lead="Not on the page.",
            topic="Fee",
            quote=None,
            related_risk_ids=[],
            agent_notes="",
            question_kind="this_company",
            web_query=None,
        )

    app.state.services.llm.complete = record
    snapshot = load_snapshot("checkout")
    price = snapshot["prices"][0]
    page = await register(client, snapshot)
    body = {
        "page_id": page["page_id"],
        "question": "Is this fee normal?",
        "pointer": {"price_id": price["id"], "field_id": "i-999", "section_id": "s-1"},
    }
    await call(client, "ask-page", body)
    pointing = seen[0].split("POINTING AT:\n", 1)[1]
    assert pointing.startswith(f"- A price: {price['label']}, {price['amount_text']}")
    assert "A form field" not in pointing  # IDs the page doesn't have are ignored


async def test_ask_page_includes_related_risks(client: httpx.AsyncClient) -> None:
    page = await register(client, "terms")
    scan = await ready_scan(client, page["page_id"])
    assert scan["risks"]
    result = (
        await call(
            client, "ask-page", {"page_id": page["page_id"], "question": "Is there a late fee?"}
        )
    ).json()
    assert len(result["card"]["risks"]) <= 3


async def test_ask_page_expired_page(client: httpx.AsyncClient) -> None:
    response = await call(client, "ask-page", {"page_id": "pg_gone", "question": "Anything?"})
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "page_not_found"


async def test_ask_page_rejects_unknown_fields(client: httpx.AsyncClient) -> None:
    page = await register(client, "terms")
    response = await call(
        client, "ask-page", {"page_id": page["page_id"], "question": "Q?", "extra": 1}
    )
    assert response.status_code == 400


async def test_explain_field_from_page_help(client: httpx.AsyncClient) -> None:
    page = await register(client, "form")
    result = (
        await call(client, "explain-field", {"page_id": page["page_id"], "field_id": "i-11"})
    ).json()
    card = result["card"]
    assert card["kind"] == "field"
    assert card["source"] == "page"
    assert card["field_id"] == "i-11"
    assert card["topic"] == "PAN"
    assert card["example"] == "ABCDE1234F"
    assert [row["label"] for row in card["rows"]] == ["What it is", "Where to find it", "Format"]
    assert result["highlight_ids"] == ["i-11"]


async def test_explain_field_by_spoken_label(client: httpx.AsyncClient) -> None:
    page = await register(client, "form")
    result = (
        await call(client, "explain-field", {"page_id": page["page_id"], "field_label": "ifsc"})
    ).json()
    assert result["card"]["field_id"] == "i-15"
    assert result["card"]["topic"] == "IFSC code"


async def test_explain_field_unknown_label(client: httpx.AsyncClient) -> None:
    page = await register(client, "form")
    response = await call(
        client, "explain-field", {"page_id": page["page_id"], "field_label": "favourite colour"}
    )
    assert response.status_code == 400
    error = response.json()["error"]
    assert error["code"] == "invalid_request"
    assert error["agent_message"].startswith(
        "I couldn't find a field called 'favourite colour' on this page. Ask the user which "
        "field they mean. For example: "
    )


async def test_explain_field_needs_a_field(client: httpx.AsyncClient) -> None:
    page = await register(client, "form")
    response = await call(client, "explain-field", {"page_id": page["page_id"]})
    assert response.status_code == 400
    assert response.json()["error"]["agent_message"] == (
        "I couldn't tell which field the user means. Ask the user which field they mean. "
        "For example: Full name (as on PAN), PAN, Date of birth."
    )


async def test_explain_field_uses_the_field_the_user_points_at(client: httpx.AsyncClient) -> None:
    page = await register(client, "form")
    for extra in ({}, {"field_label": "this field"}, {"field_id": "i-404"}):
        body = {"page_id": page["page_id"], "pointer": {"field_id": "i-15"}, **extra}
        result = (await call(client, "explain-field", body)).json()
        assert result["card"]["field_id"] == "i-15", extra


async def test_a_named_field_wins_over_the_pointer(client: httpx.AsyncClient) -> None:
    page = await register(client, "form")
    body = {"page_id": page["page_id"], "field_label": "PAN", "pointer": {"field_id": "i-15"}}
    result = (await call(client, "explain-field", body)).json()
    assert result["card"]["field_id"] == "i-11"


async def test_explain_field_takes_a_clear_loose_match(client: httpx.AsyncClient) -> None:
    page = await register(client, "form")
    body = {"page_id": page["page_id"], "field_label": "branch code"}
    result = (await call(client, "explain-field", body)).json()
    assert result["card"]["field_id"] == "i-15"


async def test_explain_field_asks_when_two_fields_are_equally_likely(
    client: httpx.AsyncClient,
) -> None:
    page = await register(client, "form")
    body = {"page_id": page["page_id"], "field_label": "bank code"}
    response = await call(client, "explain-field", body)
    assert response.status_code == 400
    message = response.json()["error"]["agent_message"]
    assert "IFSC code" in message and "Bank account number" in message


async def test_summarize(client: httpx.AsyncClient) -> None:
    page = await register(client, "privacy")
    result = (
        await call(client, "summarize", {"page_id": page["page_id"], "style": "quick"})
    ).json()
    card = result["card"]
    assert card["kind"] == "summary"
    assert card["source"] == "page"
    assert card["topic"] == "Summary"
    assert 1 <= len(card["bullets"]) <= 5
    assert all(len(bullet.split()) <= 15 for bullet in card["bullets"])


async def test_summarize_with_focus(client: httpx.AsyncClient) -> None:
    page = await register(client, "terms")
    result = (
        await call(
            client,
            "summarize",
            {"page_id": page["page_id"], "style": "detailed", "focus": "data sharing"},
        )
    ).json()
    assert result["card"]["topic"] == "Data Sharing"


async def test_scan_tool_on_checkout(client: httpx.AsyncClient) -> None:
    page = await register(client, "checkout")
    result = (await call(client, "scan", {"page_id": page["page_id"]})).json()
    card = result["card"]
    assert card["kind"] == "risk_list"
    assert len(card["risks"]) == 3
    assert result["say"] == (
        "I found 3 things worth a look. The biggest: ₹1,299 add-on already ticked. "
        "Want me to go through them?"
    )
    assert result["highlight_ids"] == ["i-20", "i-21"]


async def test_scan_tool_waits_for_terms(client: httpx.AsyncClient) -> None:
    page = await register(client, "terms")
    result = (await call(client, "scan", {"page_id": page["page_id"], "kind": "terms"})).json()
    assert len(result["card"]["risks"]) >= 5
    assert len(result["highlight_ids"]) <= 5


async def test_scan_tool_runs_a_general_scan(client: httpx.AsyncClient) -> None:
    snapshot = load_snapshot("form")
    snapshot["client_flags"] = []
    page = await register(client, snapshot)
    result = (await call(client, "scan", {"page_id": page["page_id"]})).json()
    assert result["say"] == (
        "I didn't find anything worrying on this page. Want a quick summary instead?"
    )
    scan = (await client.get(f"/api/pages/{page['page_id']}/scan")).json()
    assert scan["status"] == "ready"
    assert scan["kind"] == "general"


async def test_article_page_type_comes_from_the_model(client: httpx.AsyncClient) -> None:
    long_text = "This is a long paragraph about gardening. " * 15
    snapshot = load_snapshot("offer")
    snapshot.update(
        url="https://blog.example/post",
        title="Gardening notes",
        prices=[],
        client_flags=[],
        sections=[
            {"id": f"s-{n}", "heading": f"Part {n}", "level": 2, "text": long_text}
            for n in range(1, 4)
        ],
    )
    page = await register(client, snapshot)
    assert page["page_type"] == "article"
    assert page["scan"] == {"status": "none", "kind": None}


async def test_fake_llm_calls_are_recorded(client: httpx.AsyncClient, app) -> None:  # type: ignore[no-untyped-def]
    page = await register(client, "privacy")
    await call(client, "summarize", {"page_id": page["page_id"], "style": "quick"})
    assert await app.state.services.ledger.llm_spend_since(0) > 0


# --- Web tools ---


async def test_web_lookup_with_page(client: httpx.AsyncClient) -> None:
    page = await register(client, "terms")
    result = (
        await call(
            client, "web-lookup", {"query": "what is a NACH mandate", "page_id": page["page_id"]}
        )
    ).json()
    assert result["say"].startswith("That isn't on the page, so I looked it up.")
    card = result["card"]
    assert card["kind"] == "web_answer"
    assert card["source"] == "web"
    assert card["topic"] == "NACH mandate"
    assert 1 <= len(card["bullets"]) <= 4
    assert [source["domain"] for source in result["sources"]] == ["example.org", "example.org"]


async def test_web_lookup_without_page(client: httpx.AsyncClient) -> None:
    result = (await call(client, "web-lookup", {"query": "UPI error code U30"})).json()
    assert result["say"].startswith("I looked it up.")


async def test_web_lookup_adds_the_opener(client: httpx.AsyncClient, app) -> None:  # type: ignore[no-untyped-def]
    from app.services.llm_tasks import WebAnswer

    async def plain(task):  # type: ignore[no-untyped-def]
        return WebAnswer(
            say="NACH is an auto-debit.",
            lead="NACH is an auto-debit.",
            bullets=["Auto-debit"],
            used_sources=[1, 9],
            agent_notes="",
        )

    app.state.services.llm.complete = plain
    page = await register(client, "offer")
    result = (
        await call(client, "web-lookup", {"query": "NACH", "page_id": page["page_id"]})
    ).json()
    assert result["say"] == "That isn't on the page, so I looked it up. NACH is an auto-debit."
    assert [s["url"] for s in result["sources"]] == ["https://example.org/faq/nach"]


async def test_web_lookup_no_results(client: httpx.AsyncClient, app) -> None:  # type: ignore[no-untyped-def]
    async def nothing(query, *, max_results, topic):  # type: ignore[no-untyped-def]
        return []

    app.state.services.search.provider.search = nothing
    result = (await call(client, "web-lookup", {"query": "zzzz"})).json()
    assert result["not_found"] is True
    assert result["card"] is None
    assert result["say"] == "I couldn't find a clear answer to that online."


async def test_web_lookup_retries_with_fewer_words(client: httpx.AsyncClient, app) -> None:  # type: ignore[no-untyped-def]
    from app.services.fakes.search import FakeSearch

    queries: list[str] = []

    async def picky(query, *, max_results, topic):  # type: ignore[no-untyped-def]
        queries.append(query)
        if len(queries) == 1:
            return []
        return await FakeSearch().search(query, max_results=max_results, topic=topic)

    app.state.services.search.provider.search = picky
    body = {"query": 'what is the "UPI U30" error in my app'}
    result = (await call(client, "web-lookup", body)).json()
    assert queries == [body["query"], "UPI U30 error app"]
    assert result["card"]["kind"] == "web_answer"


async def test_explain_field_from_the_web(client: httpx.AsyncClient, app) -> None:  # type: ignore[no-untyped-def]
    page = await register(client, "form")
    body = {"page_id": page["page_id"], "field_label": "CKYC number"}
    result = (await call(client, "explain-field", body)).json()
    card = result["card"]
    assert card["source"] == "web"
    assert card["field_id"] == "i-16"
    assert card["example"] == "12345678901234"
    assert len(result["sources"]) == 2
    # The second ask comes from the 24-hour cache: no more search credits.
    await call(client, "explain-field", body)
    assert await app.state.services.ledger.search_credits_since(0) == 1


async def test_mandate_type_from_the_web(client: httpx.AsyncClient) -> None:
    page = await register(client, "form")
    result = (
        await call(client, "explain-field", {"page_id": page["page_id"], "field_id": "i-17"})
    ).json()
    assert result["card"]["source"] == "web"
    assert "NACH" in result["say"]


async def test_explain_field_falls_back_when_search_is_down(client: httpx.AsyncClient, app) -> None:  # type: ignore[no-untyped-def]
    app.state.settings.search_monthly_credit_limit = 0
    page = await register(client, "form")
    result = (
        await call(client, "explain-field", {"page_id": page["page_id"], "field_id": "i-15"})
    ).json()
    assert result["card"]["source"] == "page"
    assert result["sources"] == []


async def test_loan_cost_from_the_offer_page(client: httpx.AsyncClient) -> None:
    page = await register(client, "offer")
    result = (await call(client, "loan-cost", {"page_id": page["page_id"]})).json()
    card = result["card"]
    assert card["kind"] == "true_cost"
    assert card["source"] == "calculated"
    assert card["figure_text"] == "≈ 36.5% a year"
    assert card["apr_percent"] == 36.5
    assert card["effective_annual_percent"] == 43.3
    assert card["advertised"] == "1.5% a month flat"
    assert card["emi_inr"] == 5900
    assert card["tenure_months"] == 12
    assert card["total_paid_inr"] == 70799
    assert card["fees_upfront_inr"] == 1416
    assert card["extra_over_price_inr"] == 12216
    assert len(card["explanation"]) == 2
    assert result["say"] == (
        "'1.5% a month flat' works out to about 36.5% a year, because interest is charged on "
        "the full amount even as you pay it back. The card shows the maths."
    )


async def test_loan_cost_from_the_request_only(client: httpx.AsyncClient) -> None:
    body = {
        "principal_inr": 100000,
        "rate_percent": 1,
        "rate_basis": "flat_monthly",
        "tenure_months": 24,
    }
    card = (await call(client, "loan-cost", body)).json()["card"]
    assert card["apr_percent"] == 21.6
    assert card["fees_upfront_inr"] == 0


async def test_loan_cost_names_what_is_missing(client: httpx.AsyncClient) -> None:
    response = await call(client, "loan-cost", {"rate_percent": 1.5, "rate_basis": "flat_monthly"})
    assert response.status_code == 400
    assert response.json()["error"]["agent_message"] == (
        "I need the loan amount and the number of months to work this out. "
        "Ask the user, or check the fine print."
    )


async def test_loan_cost_rejects_silly_numbers(client: httpx.AsyncClient) -> None:
    body = {
        "principal_inr": 500,
        "rate_percent": 1,
        "rate_basis": "flat_monthly",
        "tenure_months": 12,
    }
    response = await call(client, "loan-cost", body)
    assert response.status_code == 400
    assert "₹1,000" in response.json()["error"]["message"]


async def test_loan_cost_gst_not_stated(client: httpx.AsyncClient) -> None:
    snapshot = load_snapshot("offer")
    snapshot["sections"][1]["text"] = (
        "*12 monthly instalments at 1.5% p.m. flat. Processing fee 2% + GST, deducted upfront."
    )
    page = await register(client, snapshot)
    card = (await call(client, "loan-cost", {"page_id": page["page_id"]})).json()["card"]
    assert card["explanation"][-1] == "Plus GST on the fee, which the page doesn't state."
    assert card["fees_upfront_inr"] == 1200


async def test_loan_cost_uses_the_model_and_checks_its_numbers(
    client: httpx.AsyncClient, app
) -> None:  # type: ignore[no-untyped-def]
    from app.services.llm_tasks import LoanTerms

    async def extracted(task):  # type: ignore[no-untyped-def]
        # 36 isn't written on the page, so it must be discarded.
        return LoanTerms(
            principal_inr=59999,
            rate_percent=2,
            rate_basis="flat_monthly",
            tenure_months=36,
            processing_fee_inr=None,
            processing_fee_percent=None,
            gst_percent_on_fee=None,
        )

    app.state.services.llm.complete = extracted
    snapshot = load_snapshot("offer")
    snapshot["client_flags"] = []
    snapshot["sections"][1]["text"] = (
        "Pay monthly at 2% per month on the price. Ask us for the tenure."
    )
    page = await register(client, snapshot)
    response = await call(client, "loan-cost", {"page_id": page["page_id"]})
    assert response.status_code == 400
    assert "the number of months" in response.json()["error"]["agent_message"]
