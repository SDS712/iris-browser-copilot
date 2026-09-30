"""The guided walkthrough's explanations, in fake mode."""

from typing import Any

import httpx

from app.services.llm_tasks import WalkthroughLine, WalkthroughLines
from tests.helpers import load_snapshot, ready_scan, register


async def explain(client: httpx.AsyncClient, body: dict[str, Any]) -> httpx.Response:
    return await client.post("/api/tools/walkthrough", json=body)


async def test_explains_up_to_five_sections_in_order(client: httpx.AsyncClient) -> None:
    page = await register(client, "terms")
    ids = ["s-5", "s-6", "s-99", "s-11"]
    result = (await explain(client, {"page_id": page["page_id"], "section_ids": ids})).json()
    assert result["contract_version"] == 1
    steps = result["steps"]
    # Unknown IDs are dropped; the rest keep their order.
    assert [step["key"] for step in steps] == ["s-5", "s-6", "s-11"]
    assert steps[2]["heading"] == "5.1 Late fee"
    assert all(0 < len(step["say"].split()) <= 31 for step in steps)


async def test_risks_found_in_a_section_come_with_its_step(client: httpx.AsyncClient) -> None:
    page = await register(client, "terms")
    scan = await ready_scan(client, page["page_id"])
    with_risk = next(r for r in scan["risks"] if r["section_id"])
    body = {"page_id": page["page_id"], "section_ids": [with_risk["section_id"]]}
    step = (await explain(client, body)).json()["steps"][0]
    assert with_risk["id"] in step["risk_ids"]


async def test_an_empty_answer_falls_back_to_the_first_sentence(
    client: httpx.AsyncClient, app
) -> None:  # type: ignore[no-untyped-def]
    async def empty(task):  # type: ignore[no-untyped-def]
        return WalkthroughLines(steps=[WalkthroughLine(key="s-11", say="  ")])

    app.state.services.llm.complete = empty
    page = await register(client, "terms")
    body = {"page_id": page["page_id"], "section_ids": ["s-11"]}
    step = (await explain(client, body)).json()["steps"][0]
    assert step["say"]
    assert len(step["say"].split()) <= 31


async def test_limits(client: httpx.AsyncClient) -> None:
    page = await register(client, "terms")
    too_many = {"page_id": page["page_id"], "section_ids": [f"s-{n}" for n in range(1, 7)]}
    assert (await explain(client, too_many)).status_code == 400
    assert (
        await explain(client, {"page_id": page["page_id"], "section_ids": []})
    ).status_code == 400
    gone = await explain(client, {"page_id": "pg_gone", "section_ids": ["s-1"]})
    assert gone.status_code == 404


# --- Forms ---

PARTS = [
    {"key": "part-1", "heading": "About you", "element_ids": ["i-10", "i-11", "i-12", "i-13"]},
    {"key": "part-2", "heading": "Bank details", "element_ids": ["i-14", "i-15", "i-99"]},
    {"key": "part-3", "heading": "Checkboxes", "element_ids": ["i-19", "i-20"]},
]


async def test_explains_the_parts_of_a_form(client: httpx.AsyncClient) -> None:
    page = await register(client, "form")
    body = {"page_id": page["page_id"], "form_steps": PARTS}
    steps = (await explain(client, body)).json()["steps"]
    assert [step["key"] for step in steps] == ["part-1", "part-2", "part-3"]
    assert steps[1]["heading"] == "Bank details"
    # Fake mode says what the part asks for; the unknown ID is simply left out.
    assert steps[1]["say"] == "This part asks for your Bank account number and IFSC code."
    assert all(len(step["say"].split()) <= 36 for step in steps)


async def test_the_model_sees_labels_and_states_never_values(
    client: httpx.AsyncClient, app
) -> None:  # type: ignore[no-untyped-def]
    seen: list[str] = []

    async def record(task):  # type: ignore[no-untyped-def]
        seen.append(str(task.messages[1]["content"]))
        return WalkthroughLines(
            steps=[WalkthroughLine(key="part-3", say="Heads up: one box is ticked.")]
        )

    app.state.services.llm.complete = record
    snapshot = load_snapshot("form")
    snapshot["fields"][0]["filled"] = True
    page = await register(client, snapshot)
    body = {"page_id": page["page_id"], "form_steps": PARTS}
    steps = (await explain(client, body)).json()["steps"]
    context = seen[0]
    assert '- Field "Full name (as on PAN)" (text, required, already filled)' in context
    assert "sensitive: never to be said aloud" in context
    assert "ticked by the site before the person touched it" in context
    assert "value" not in context.lower()
    # Parts the model said nothing about fall back to the plain line.
    assert steps[0]["say"].startswith("This part asks for your Full name (as on PAN), PAN")
    assert steps[2]["say"] == "Heads up: one box is ticked."


async def test_one_kind_of_step_per_request(client: httpx.AsyncClient) -> None:
    page = await register(client, "form")
    both = {"page_id": page["page_id"], "section_ids": ["s-1"], "form_steps": PARTS[:1]}
    assert (await explain(client, both)).status_code == 400
    too_many = {"page_id": page["page_id"], "form_steps": PARTS * 2}
    assert (await explain(client, too_many)).status_code == 400
