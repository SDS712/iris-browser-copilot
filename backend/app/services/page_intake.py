"""Registering a page snapshot."""

import json
from typing import Any

from app.errors import ErrorCode, IrisError
from app.schemas.api import CreatePageResponse, ScanBrief
from app.schemas.common import PageType
from app.schemas.snapshot import PageSnapshot
from app.services.container import Services
from app.services.llm import FAST_TIMEOUT, LlmTask, build_messages
from app.services.llm_tasks import PageTypeAnswer
from app.services.pages import (
    Page,
    SectionIndex,
    build_summary,
    chunk_sections,
    content_hash,
    long_sections,
    new_page_id,
    prepare_sections,
    rule_page_type,
    url_path,
)
from app.services.site_signals import site_signals

MAX_SNAPSHOT_BYTES = 400 * 1024


class _ValueKeyFound(Exception):
    pass


def _reject_value_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    if any(key == "value" for key, _ in pairs):
        raise _ValueKeyFound
    return dict(pairs)


def check_raw_snapshot(raw: bytes) -> None:
    """Second line of defence: no `value` key anywhere, and at most 400 KB."""
    if len(raw) > MAX_SNAPSHOT_BYTES:
        raise IrisError(ErrorCode.PAYLOAD_TOO_LARGE)
    try:
        json.loads(raw, object_pairs_hook=_reject_value_keys)
    except _ValueKeyFound:
        raise IrisError(
            ErrorCode.INVALID_REQUEST, "Snapshots must never contain field values."
        ) from None
    except ValueError:
        # Malformed JSON is reported by request validation with its own message.
        return


def sanitise(snapshot: PageSnapshot) -> PageSnapshot:
    fields = [
        field.model_copy(update={"placeholder": None}) if field.sensitive else field
        for field in snapshot.fields
    ]
    return snapshot.model_copy(update={"fields": fields})


async def decide_page_type(services: Services, snapshot: PageSnapshot) -> PageType:
    by_rule = rule_page_type(snapshot)
    if by_rule is not None:
        return by_rule
    if long_sections(snapshot) >= 3:
        # Long text with no clear signal: ask the fast model, from headings only.
        headings = "\n".join(s.heading for s in snapshot.sections if s.heading) or "(none)"
        task = LlmTask(
            name="page_type",
            output=PageTypeAnswer,
            model=services.settings.llm_model_fast,
            purpose="page_type",
            messages=build_messages(
                "page_type",
                f"TITLE: {snapshot.title}\nURL PATH: {url_path(snapshot.url)}\n"
                f"HEADINGS:\n{headings}",
            ),
            max_tokens=50,
            timeout=FAST_TIMEOUT,
        )
        try:
            return (await services.llm.complete(task)).page_type
        except IrisError:
            return "article"
    return "other"


async def register(services: Services, snapshot: PageSnapshot) -> CreatePageResponse:
    snapshot = sanitise(snapshot)
    page_type = await decide_page_type(services, snapshot)
    sections = prepare_sections(snapshot)
    page = Page(
        page_id=new_page_id(),
        snapshot=snapshot,
        page_type=page_type,
        sections=sections,
        index=SectionIndex(chunk_sections(sections)),
        content_hash=content_hash(snapshot, sections),
        summary_for_agent=build_summary(snapshot, page_type),
    )
    services.pages.add(page)
    state = services.scans.start(page)
    return CreatePageResponse(
        page_id=page.page_id,
        page_type=page_type,
        summary_for_agent=page.summary_for_agent,
        scan=ScanBrief(status=state.status, kind=state.kind),
        site_signals=site_signals(snapshot),
    )
