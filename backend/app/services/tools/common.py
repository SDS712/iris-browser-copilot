"""Building a ToolResult: every say line goes through say.finalise()."""

from collections.abc import Iterable

from app.schemas.api import ToolResult
from app.schemas.cards import Card
from app.schemas.common import Source
from app.services.pages import STOPWORDS
from app.services.say import finalise
from app.settings import Settings

MAX_NOTES = 600


def clip_notes(notes: str) -> str:
    notes = " ".join(notes.split())
    return notes if len(notes) <= MAX_NOTES else notes[: MAX_NOTES - 1].rstrip() + "…"


def tool_result(
    settings: Settings,
    *,
    say: str,
    card: Card | None,
    agent_notes: str = "",
    highlight_ids: Iterable[str] = (),
    quote_text: str | None = None,
    sources: Iterable[Source] = (),
    not_found: bool = False,
) -> ToolResult:
    return ToolResult(
        say=finalise(say, speakable_say=settings.iris_speakable_say),
        agent_notes=clip_notes(agent_notes),
        card=card,
        highlight_ids=list(dict.fromkeys(highlight_ids)),
        quote_text=quote_text,
        sources=list(sources),
        not_found=not_found,
    )


def topic_words(text: str, fallback: str) -> str:
    """1–3 words for a card's topic label."""
    words = text.replace("(", " ").replace(")", " ").split()[:3]
    return " ".join(words) if words else fallback


_QUERY_FILLER = STOPWORDS | {"mean", "means", "meaning", "explain", "tell", "about", "india"}


def query_topic(query: str) -> str:
    """'what is a NACH mandate' → 'NACH mandate'."""
    words = [word.strip("?.,!'\"") for word in query.split()]
    kept = [word for word in words if word and word.lower() not in _QUERY_FILLER]
    return " ".join(kept[:3]) or "Web answer"
