"""Smaller pieces: TTL cache, long pages, crash handling, fakes and the speakable setting."""

import httpx
import pytest
from fastapi import FastAPI

from app.services.fakes.llm import HANDLERS
from app.services.pages import SectionIndex, chunk_sections, prepare_sections
from app.services.tools.ask_page import MAX_CONTEXT_CHARS, pick_sections
from app.services.ttl_cache import TTLCache
from tests.helpers import load_snapshot, ready_scan, register, snapshot_model


def test_ttl_cache_expiry_and_size() -> None:
    now = [0.0]
    cache: TTLCache[str, int] = TTLCache(10, 2, clock=lambda: now[0])
    cache.set("a", 1)
    cache.set("b", 2)
    cache.set("c", 3)
    assert cache.get("a") is None  # oldest dropped at the size limit
    assert len(cache) == 2
    now[0] = 11
    assert cache.get("b") is None
    assert cache.get("missing") is None


def test_long_pages_send_the_best_sections_in_page_order() -> None:
    snapshot = snapshot_model("terms")
    filler = " ".join(["clause text about other matters"] * 120)
    sections = [s.model_copy(update={"text": s.text + " " + filler}) for s in snapshot.sections]
    snapshot = snapshot.model_copy(update={"sections": sections})
    prepared = prepare_sections(snapshot)
    from app.services.pages import Page

    page = Page(
        page_id="pg_x",
        snapshot=snapshot,
        page_type="terms",
        sections=prepared,
        index=SectionIndex(chunk_sections(prepared)),
        content_hash="h",
        summary_for_agent="",
    )
    chosen = pick_sections(page, "Can I cancel QuickCred Plus?")
    assert sum(len(s.labelled()) for s in chosen) <= MAX_CONTEXT_CHARS
    assert [s.order for s in chosen] == sorted(s.order for s in chosen)
    assert any(s.heading == "7.2 Cancellation" for s in chosen)
    assert len(chosen) < len(prepared)


def test_fake_llm_handles_every_task() -> None:
    assert set(HANDLERS) == {
        "ask_page_answer",
        "field_help",
        "page_summary",
        "scan_findings",
        "web_answer",
        "scam_reports",
        "loan_terms",
        "page_type",
        "journey_summary",
        "walkthrough_steps",
    }


async def test_unexpected_errors_become_internal_error(
    client: httpx.AsyncClient, app: FastAPI, caplog: pytest.LogCaptureFixture
) -> None:
    async def explode(*args: object, **kwargs: object) -> None:
        raise ZeroDivisionError("boom")

    app.state.services.budget.status = explode
    response = await client.get("/api/health")
    assert response.status_code == 500
    body = response.json()
    assert body["error"]["code"] == "internal_error"
    assert "boom" not in response.text
    assert "ZeroDivisionError" not in response.text
    assert any(record.exc_info for record in caplog.records)


async def test_streamed_body_over_the_limit(client: httpx.AsyncClient) -> None:
    async def chunks():  # type: ignore[no-untyped-def]
        for _ in range(460):
            yield b" " * 1024

    response = await client.post(
        "/api/pages", content=chunks(), headers={"Content-Type": "application/json"}
    )
    assert response.status_code == 413


async def test_speakable_say_setting(client: httpx.AsyncClient, app: FastAPI) -> None:
    app.state.settings.iris_speakable_say = True
    page = await register(client, "offer")
    result = (await client.post("/api/tools/loan-cost", json={"page_id": page["page_id"]})).json()
    assert "₹" not in result["say"]
    assert result["card"]["lead"].count("₹") >= 1  # cards keep ₹
    snapshot = load_snapshot("checkout")
    checkout = await register(client, snapshot)
    scan = await ready_scan(client, checkout["page_id"])
    assert scan["nudge"]["say"].startswith(
        "Before you pay: a 1,299 rupees add-on is already ticked"
    )
