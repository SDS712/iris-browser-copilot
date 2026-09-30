"""web_lookup: answers from search results, with the sources on the card."""

from app.schemas.api import ToolResult, WebLookupRequest
from app.schemas.cards import WebAnswerCard
from app.services.container import Services
from app.services.llm import FAST_TIMEOUT, LlmTask, build_messages
from app.services.llm_tasks import SearchHitFake, WebAnswer, WebAnswerFake
from app.services.pages import STOPWORDS
from app.services.search import SearchHit, normalise_query
from app.services.tools.common import query_topic, tool_result

NO_RESULTS_SAY = "I couldn't find a clear answer to that online."
ON_PAGE_OPENER = "That isn't on the page, so I looked it up."
_OPENERS = ("that isn't on the page", "that's not on the page", "it isn't on the page")
MAX_BULLETS = 4


def numbered_results(hits: list[SearchHit]) -> str:
    return "\n\n".join(
        f"[{index}] {hit.title}\nSOURCE: {hit.domain}\n{hit.content[:800]}"
        for index, hit in enumerate(hits)
    )


def with_opener(say: str, on_page: bool) -> str:
    if on_page and not say.strip().lower().startswith(_OPENERS):
        return f"{ON_PAGE_OPENER} {say.strip()}"
    return say


def broader_query(query: str) -> str | None:
    """The query without quotes and filler words, at most 6 words; None if that's no change."""
    words = [word.strip("?.,!:;'\"()") for word in query.replace('"', " ").split()]
    kept = [word for word in words if word and word.lower() not in STOPWORDS][:6]
    broader = " ".join(kept)
    return broader if broader and normalise_query(broader) != normalise_query(query) else None


async def search_with_retry(services: Services, query: str) -> list[SearchHit]:
    """Tries once more with fewer words instead of asking the user to rephrase."""
    hits = await services.search.search(query)
    broader = None if hits else broader_query(query)
    return await services.search.search(broader) if broader else hits


async def answer_from_web(
    services: Services, query: str, *, on_page: bool, question: str | None = None
) -> ToolResult | None:
    """A web answer with its sources, or None if the search found nothing. `question` is the
    user's own words when they differ from the search query (ask_page's fallback)."""
    hits = await search_with_retry(services, query)
    if not hits:
        return None
    asked = f"QUESTION: {question}\nSEARCHED FOR: {query}" if question else f"QUESTION: {query}"
    context = (
        f"{asked}\nPAGE OPEN: {'yes' if on_page else 'no'}\n\nRESULTS:\n{numbered_results(hits)}"
    )
    task = LlmTask(
        name="web_answer",
        output=WebAnswer,
        model=services.settings.llm_model_fast,
        purpose="web_lookup",
        messages=build_messages("web_answer", context),
        max_tokens=700,
        timeout=FAST_TIMEOUT,
        fake_input=WebAnswerFake(
            query=query,
            results=[SearchHitFake(title=hit.title, content=hit.content) for hit in hits],
            on_page=on_page,
        ),
    )
    answer = await services.llm.complete(task)
    used = [hits[i] for i in dict.fromkeys(answer.used_sources) if 0 <= i < len(hits)]
    card = WebAnswerCard(
        topic=query_topic(query),
        source="web",
        lead=answer.lead,
        bullets=answer.bullets[:MAX_BULLETS],
    )
    return tool_result(
        services.settings,
        say=with_opener(answer.say, on_page),
        card=card,
        agent_notes=answer.agent_notes,
        sources=[hit.source() for hit in used or hits[:3]],
    )


async def web_lookup(services: Services, request: WebLookupRequest) -> ToolResult:
    on_page = request.page_id is not None
    if request.page_id:
        services.pages.get(request.page_id)
    result = await answer_from_web(services, request.query, on_page=on_page)
    return result or tool_result(services.settings, say=NO_RESULTS_SAY, card=None, not_found=True)
