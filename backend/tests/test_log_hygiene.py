"""No page text, headings, labels, questions, answers or full URLs in any log line."""

import logging

import httpx
import pytest

from app.logging import JsonFormatter
from tests.helpers import load_snapshot, ready_scan

SENTINELS = [
    "zebratitle7731",
    "zebraheading7731",
    "zebratext7731",
    "zebralabel7731",
    "zebraquestion7731",
    "zebraquery7731",
    "zebrapath7731",
    "zebrafocus7731",
]


async def test_no_page_content_in_logs(
    client: httpx.AsyncClient, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG)
    snapshot = load_snapshot("terms")
    snapshot["title"] = "Terms zebratitle7731"
    snapshot["url"] = "https://iris.example.com/zebrapath7731/terms?q=zebraquery7731"
    snapshot["sections"][18]["heading"] = "7.2 Cancellation zebraheading7731"
    snapshot["sections"][18]["text"] += " zebratext7731."
    snapshot["fields"] = load_snapshot("form")["fields"]
    snapshot["fields"][0]["label"] = "Full name zebralabel7731"

    page = (await client.post("/api/pages", json={"snapshot": snapshot})).json()
    page_id = page["page_id"]
    await ready_scan(client, page_id, exclude="page_text:costs_money:s-19")
    calls = [
        ("ask-page", {"page_id": page_id, "question": "Can I cancel zebraquestion7731?"}),
        ("ask-page", {"page_id": page_id, "question": "Cancellation zebraheading7731"}),
        ("explain-field", {"page_id": page_id, "field_label": "Full name zebralabel7731"}),
        ("explain-field", {"page_id": page_id, "field_label": "zebralabel7731 unknown thing"}),
        ("summarize", {"page_id": page_id, "style": "quick", "focus": "zebrafocus7731"}),
        ("scan", {"page_id": page_id}),
        ("web-lookup", {"query": "zebraquery7731 meaning", "page_id": page_id}),
        ("site-trust", {"url": "https://zebrapath7731.example.net/a?q=zebraquery7731"}),
        ("loan-cost", {"page_id": page_id}),
    ]
    for tool, body in calls:
        await client.post(f"/api/tools/{tool}", json=body)
    # A rejected snapshot must not echo its content either.
    snapshot["fields"][0]["value"] = "zebratext7731"
    await client.post("/api/pages", json={"snapshot": snapshot})

    formatter = JsonFormatter()
    logged = "\n".join(formatter.format(record) for record in caplog.records).lower()
    assert "request" in logged  # the access lines were captured
    for sentinel in SENTINELS:
        assert sentinel not in logged, sentinel
