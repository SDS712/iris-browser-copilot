"""summarize."""

from app.schemas.api import SummarizeRequest, ToolResult
from app.schemas.cards import SummaryCard
from app.services.container import Services
from app.services.llm import FAST_TIMEOUT, LlmTask, build_messages
from app.services.llm_tasks import PageSummary, SectionsFake
from app.services.pages import Page
from app.services.tools.common import tool_result, topic_words

FULL_TEXT_LIMIT = 20_000
EXCERPT_CHARS = 300
MAX_BULLETS = 5
MAX_BULLET_WORDS = 14


def summary_context(page: Page) -> str:
    if page.total_chars <= FULL_TEXT_LIMIT:
        body = "\n\n".join(section.labelled() for section in page.sections)
    else:
        # Long pages: every heading plus the start of each section, in order.
        body = "\n\n".join(
            f"[{s.id}] {s.heading or ''}\n{s.text[:EXCERPT_CHARS]}" for s in page.sections
        )
    return f"{page.header()}\n\nSECTIONS:\n{body or '(no text)'}"


def _short(bullet: str) -> str:
    words = bullet.split()
    return bullet if len(words) <= MAX_BULLET_WORDS else " ".join(words[:MAX_BULLET_WORDS]) + "…"


async def summarize(services: Services, request: SummarizeRequest) -> ToolResult:
    page = services.pages.get(request.page_id)
    ask = f"STYLE: {request.style}\nFOCUS: {request.focus or '(none)'}"
    task = LlmTask(
        name="page_summary",
        output=PageSummary,
        model=services.settings.llm_model_fast,
        purpose="summarize",
        messages=build_messages("summarize", summary_context(page), ask),
        max_tokens=700,
        timeout=FAST_TIMEOUT,
        fake_input=SectionsFake(page.sections),
    )
    summary = await services.llm.complete(task)
    topic = topic_words(request.focus.title(), "Summary") if request.focus else "Summary"
    card = SummaryCard(
        topic=topic,
        source="page",
        lead=summary.lead,
        bullets=[_short(bullet) for bullet in summary.bullets[:MAX_BULLETS]],
    )
    return tool_result(
        services.settings, say=summary.say, card=card, agent_notes=summary.agent_notes
    )
