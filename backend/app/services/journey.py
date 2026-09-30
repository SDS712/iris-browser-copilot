"""The rolling summary of a tab's earlier pages: nothing is stored here."""

from app.schemas.api import JourneySummaryRequest, JourneySummaryResponse
from app.services.container import Services
from app.services.llm import FAST_TIMEOUT, LlmTask, build_messages
from app.services.llm_tasks import JourneyFake, JourneySummary

MAX_SUMMARY_CHARS = 1_200


def clip_summary(text: str) -> str:
    text = " ".join(text.split())
    return text if len(text) <= MAX_SUMMARY_CHARS else text[: MAX_SUMMARY_CHARS - 1].rstrip() + "…"


async def summarise(services: Services, request: JourneySummaryRequest) -> JourneySummaryResponse:
    pages = "\n".join(f"- {fact}" for fact in request.facts)
    context = f"PREVIOUS SUMMARY: {request.previous_summary or '(none)'}\n\nPAGES:\n{pages}"
    task = LlmTask(
        name="journey_summary",
        output=JourneySummary,
        model=services.settings.llm_model_fast,
        purpose="journey_summary",
        messages=build_messages("journey_summary", context),
        max_tokens=500,
        timeout=FAST_TIMEOUT,
        fake_input=JourneyFake(facts=request.facts, previous_summary=request.previous_summary),
    )
    answer = await services.llm.complete(task)
    return JourneySummaryResponse(summary=clip_summary(answer.summary))
