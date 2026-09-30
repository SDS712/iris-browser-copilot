"""ask_page: answers grounded in the page's own text (and the earlier pages in
the tab when they're relevant), or from the web when the page doesn't say and a search
clearly fits (a general fact, not this site's own terms)."""

import asyncio
import math
import re
from collections.abc import Sequence
from dataclasses import dataclass

from app.errors import ErrorCode, IrisError
from app.schemas.api import AskPageRequest, PointerHint, ToolResult
from app.schemas.cards import AnswerCard, AnswerQuote
from app.services.container import Services
from app.services.grounding import find_quote
from app.services.llm import DEEP_TIMEOUT, LlmTask, build_messages
from app.services.llm_tasks import AskPageAnswer, AskPageFake
from app.services.pages import (
    STOPWORDS,
    Page,
    PreparedSection,
    shared_words,
    tokenise,
    url_path,
)
from app.services.tools.common import tool_result, topic_words
from app.services.tools.web_lookup import answer_from_web

MAX_CONTEXT_CHARS = 12_000
# With earlier pages in the tab, the current page keeps most of the budget.
CURRENT_CHARS_WITH_EARLIER = 9_000
EARLIER_CHARS = 4_000
EARLIER_TOP_CHUNKS = 4
# An earlier page's chunk counts only if it matches the question about as well as the
# current page does; a page the question names ("the offer page") always counts.
EARLIER_MIN_SCORE = 1.0
EARLIER_RELATIVE_SCORE = 0.5
_GENERAL_RE = re.compile(
    r"\b(what is|what's an?|what does|means?|meaning|rbi|laws?|legal|rules?|normal|typical|"
    r"fair|allowed|registered|licensed|reviews?|legit|scam|complaints?)\b",
    re.IGNORECASE,
)
_POINTING_RE = re.compile(r"\b(this|that|these|those|here|it)\b", re.IGNORECASE)
_NUMBER_RE = re.compile(r"\d+(?:[.,]\d+)*")
_EARLIER_WORDS_RE = re.compile(
    r"\b(earlier|previous|before|last page|other page|first page)\b", re.IGNORECASE
)
TOP_CHUNKS = 8
# Kinds the web can answer when the page doesn't; "comparison" is searched even when it does.
LOOK_UP_KINDS = frozenset({"general", "company_public", "comparison"})
NOT_CLEAR_SAY = "The page doesn't clearly say that."
OFFER_LOOKUP = "Want me to look it up?"
NOTHING_ONLINE = "I couldn't find a clear answer online either."
SEARCH_DOWN = "I can't search the web just now."


def pick_sections(
    page: Page,
    question: str,
    pinned: PreparedSection | None = None,
    limit: int = MAX_CONTEXT_CHARS,
) -> list[PreparedSection]:
    """The whole page if it's short; otherwise the section the user points at and the best
    BM25 sections, in page order."""
    if sum(len(s.labelled()) for s in page.sections) <= limit:
        return list(page.sections)
    chosen: list[PreparedSection] = [pinned] if pinned else []
    size = len(pinned.labelled()) if pinned else 0
    for chunk, _ in page.index.search(question, top_k=TOP_CHUNKS):
        section = page.section_by_id[chunk.section_id]
        if section in chosen or size + len(section.labelled()) > limit:
            continue
        chosen.append(section)
        size += len(section.labelled())
    return sorted(chosen, key=lambda section: section.order)


@dataclass(frozen=True)
class EarlierPage:
    """A page visited before the current one, as the model sees it: "p1" is the newest."""

    key: str
    page: Page
    sections: list[PreparedSection]


def named_pages(question: str, pages: list[Page]) -> set[str]:
    """Pages the question names by a word of their title or URL path, or "the previous page"."""
    words = {w for w in tokenise(question) if len(w) >= 4 and w not in STOPWORDS}
    named = {
        page.page_id
        for page in pages
        if words & set(tokenise(f"{page.snapshot.title} {url_path(page.snapshot.url)}"))
    }
    if not named and pages and _EARLIER_WORDS_RE.search(question):
        named.add(pages[0].page_id)
    return named


def pick_earlier(services: Services, request: AskPageRequest, current: Page) -> list[EarlierPage]:
    """The earlier pages' best sections for this question, within their own budget. Pages
    that have expired are skipped, and a plain question about this page reads none."""
    pages = [
        page
        for page_id in dict.fromkeys(request.earlier_page_ids)
        if page_id != current.page_id and (page := services.pages.find(page_id)) is not None
    ]
    if not pages:
        return []
    current_best = max(
        (score for _, score in current.index.search(request.question, 1)), default=0.0
    )
    threshold = max(EARLIER_MIN_SCORE, EARLIER_RELATIVE_SCORE * current_best)
    named = named_pages(request.question, pages)
    # Or share at least half the question's words (two at least): see shared_words().
    need = max(2, math.ceil(len(set(tokenise(request.question))) / 2))
    scored: list[tuple[float, int, PreparedSection]] = []
    for rank, page in enumerate(pages):
        scores = {
            chunk.section_id: score
            for chunk, score in page.index.search(request.question, top_k=EARLIER_TOP_CHUNKS)
        }
        relevant = []
        for section in page.sections:
            score, shared = scores.get(section.id, 0.0), shared_words(request.question, section)
            if score >= threshold or shared >= need or (page.page_id in named and score + shared):
                relevant.append((score + shared, rank, section))
        if not relevant and page.page_id in named:
            # "What did the offer page say?": the page's opening sections.
            relevant = [(0.0, rank, section) for section in page.sections[:2]]
        scored += relevant
    named_ranks = {rank for rank, page in enumerate(pages) if page.page_id in named}
    chosen: dict[int, list[PreparedSection]] = {}
    size = 0
    # Named pages first, then the best matches.
    for _, rank, section in sorted(scored, key=lambda item: (item[1] not in named_ranks, -item[0])):
        if section in chosen.get(rank, []) or size + len(section.labelled()) > EARLIER_CHARS:
            continue
        chosen.setdefault(rank, []).append(section)
        size += len(section.labelled())
    return [
        EarlierPage(
            key=f"p{rank + 1}",
            page=pages[rank],
            sections=sorted(sections, key=lambda section: section.order),
        )
        for rank, sections in sorted(chosen.items())
    ]


def earlier_context(earlier: Sequence[EarlierPage]) -> str:
    blocks = []
    for item in earlier:
        snapshot = item.page.snapshot
        where = f"type: {item.page.page_type}, {url_path(snapshot.url)}"
        head = f"PAGE {item.key}: {snapshot.title} ({where})"
        body = "\n\n".join(
            f"[{item.key}:{section.id}]{f' {section.heading}' if section.heading else ''}\n"
            f"{section.text}"
            for section in item.sections
        )
        blocks.append(f"{head}\n{body}")
    return "\n\n".join(blocks) or "(none)"


def pointed_section(page: Page, pointer: PointerHint | None) -> PreparedSection | None:
    return page.section_by_id.get(pointer.section_id or "") if pointer else None


def pointer_lines(page: Page, pointer: PointerHint | None) -> list[str]:
    """What the user points at, most specific first. IDs the page doesn't have are ignored."""
    if pointer is None:
        return []
    lines = []
    price = next((p for p in page.snapshot.prices if p.id == pointer.price_id), None)
    if price:
        lines.append(f"A price: {price.label or '(no label)'}, {price.amount_text}")
    field = next((f for f in page.snapshot.fields if f.id == pointer.field_id), None)
    if field:
        help_text = f" (help text: {field.help_text})" if field.help_text else ""
        lines.append(f"A form field: {field.label}{help_text}")
    section = pointed_section(page, pointer)
    if section:
        lines.append(f"Inside section {section.labelled().splitlines()[0]}")
    return lines


def page_context(
    page: Page,
    sections: list[PreparedSection],
    pointing: list[str],
    earlier: Sequence[EarlierPage] = (),
) -> str:
    risks = page.scan.risks if page.scan and page.scan.status == "ready" else []
    known = "\n".join(f"[{risk.flag.id}] {risk.flag.title}" for risk in risks) or "(none)"
    body = "\n\n".join(section.labelled() for section in sections) or "(no text)"
    pointed = "\n".join(f"- {line}" for line in pointing) or "(nothing)"
    return (
        f"{page.header()}\n\nSECTIONS:\n{body}\n\nKNOWN RISKS:\n{known}\n\nPOINTING AT:\n{pointed}"
        f"\n\nEARLIER PAGES IN THIS TAB:\n{earlier_context(earlier)}"
    )


def locate_quote(
    page: Page, earlier: list[EarlierPage], section_id: str, text: str
) -> tuple[Page, str, str] | None:
    """The page, section and exact text of a quote; "p2:s-7" names an earlier page. A quote
    without a page key that isn't on this page may still be on an earlier one."""
    key, _, local_id = section_id.rpartition(":")
    named = next((item.page for item in earlier if item.key == key), None)
    candidates = [named] if named else [page, *(item.page for item in earlier)]
    for source in candidates:
        found = find_quote(source.section_by_id, local_id if named else section_id, text)
        if found:
            return source, *found
    return None


async def web_instead(services: Services, query: str, question: str) -> ToolResult | str:
    """The web answer, or the sentence to add when there isn't one."""
    try:
        found = await answer_from_web(services, query, on_page=True, question=question)
    except IrisError as exc:
        if exc.code not in (ErrorCode.UPSTREAM_ERROR, ErrorCode.UPSTREAM_TIMEOUT):
            raise
        return SEARCH_DOWN
    return found or NOTHING_ONLINE


def looks_general(question: str) -> bool:
    """A question the web may well answer, worded so it can be searched as it stands
    ("what is a CIBIL score?"). "Is this fee normal?" needs the page to say what "this" is."""
    return bool(_GENERAL_RE.search(question)) and not _POINTING_RE.search(question)


def adds_figures(query: str, question: str) -> bool:
    """The model's search names figures the question didn't ("4% foreclosure charge")."""
    return bool(set(_NUMBER_RE.findall(query)) - set(_NUMBER_RE.findall(question)))


def discard(task: asyncio.Task[ToolResult | str] | None) -> None:
    """Drops a prefetch that isn't needed; its failure, if any, is of no interest."""
    if task is None:
        return
    if task.done():
        if not task.cancelled():
            task.exception()
        return
    task.cancel()


async def ask_page(services: Services, request: AskPageRequest) -> ToolResult:
    page = services.pages.get(request.page_id)
    # A general question's web answer starts alongside the page model.
    prefetch = (
        asyncio.create_task(web_instead(services, request.question, request.question))
        if looks_general(request.question)
        else None
    )
    try:
        return await answer_question(services, request, page, prefetch)
    finally:
        discard(prefetch)


async def answer_question(
    services: Services,
    request: AskPageRequest,
    page: Page,
    prefetch: asyncio.Task[ToolResult | str] | None,
) -> ToolResult:
    pinned = pointed_section(page, request.pointer)
    earlier = pick_earlier(services, request, page)
    limit = CURRENT_CHARS_WITH_EARLIER if earlier else MAX_CONTEXT_CHARS
    sections = pick_sections(page, request.question, pinned, limit)
    pointing = pointer_lines(page, request.pointer)
    task = LlmTask(
        name="ask_page_answer",
        output=AskPageAnswer,
        model=services.settings.llm_model_deep,
        purpose="ask_page",
        messages=build_messages(
            "ask_page",
            page_context(page, sections, pointing, earlier),
            f"QUESTION: {request.question}",
        ),
        max_tokens=800,
        timeout=DEEP_TIMEOUT,
        fake_input=AskPageFake(
            question=request.question,
            page=page,
            pointed_section_id=pinned.id if pinned else None,
            earlier=[(item.key, item.page) for item in earlier],
        ),
    )
    answer = await services.llm.complete(task)
    topic = topic_words(answer.topic, "Answer")
    located = None
    if answer.answer_type == "from_page" and answer.quote:
        located = locate_quote(page, earlier, answer.quote.section_id, answer.quote.text)

    # The user asked Iris to look things up without asking first when that fits. "Is this
    # fee normal?" needs the web even when the page states the fee.
    missing_online = None
    look_up = located is None or answer.question_kind == "comparison"
    if look_up and answer.web_query and answer.question_kind in LOOK_UP_KINDS:
        if prefetch is not None and not adds_figures(answer.web_query, request.question):
            web = await prefetch
        else:
            web = await web_instead(services, answer.web_query, request.question)
        if not isinstance(web, str):
            return web
        missing_online = web

    if located is None:
        # Unverified answers are treated as "not on the page": nothing unquoted is stated.
        say = answer.say if answer.answer_type == "not_on_page" else NOT_CLEAR_SAY
        if missing_online:
            say = f"{say} {missing_online}"
        elif answer.answer_type == "from_page":
            say = f"{say} {OFFER_LOOKUP}"
        lead = (
            answer.lead if answer.answer_type == "not_on_page" else "The page doesn't clearly say."
        )
        card = AnswerCard(topic=topic, source="not_found", lead=lead, quote=None, risks=[])
        return tool_result(
            services.settings, say=say, card=card, agent_notes=answer.agent_notes, not_found=True
        )

    source, section_id, quote = located
    section = source.section_by_id[section_id]
    here = source is page
    risks = source.scan.risks if source.scan and source.scan.status == "ready" else []
    related = [r.flag for r in risks if r.flag.id in answer.related_risk_ids][:3] if here else []
    card = AnswerCard(
        topic=topic,
        source="page",
        lead=answer.lead,
        quote=AnswerQuote(
            text=quote,
            section_id=section_id,
            section_heading=section.heading,
            page_title=None if here else source.snapshot.title,
            page_url=None if here else source.snapshot.url,
        ),
        risks=related,
    )
    # An earlier page's section isn't on screen, so there's nothing to highlight.
    return tool_result(
        services.settings,
        say=answer.say,
        card=card,
        agent_notes=answer.agent_notes,
        highlight_ids=[section_id] if here else [],
        quote_text=quote if here else None,
    )
