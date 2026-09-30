"""Output schemas for every LLM task, and the inputs the fake LLM works from.

Length limits live in the prompts and are enforced by trimming after parsing,
because Claude's strict structured outputs reject maxLength/maxItems.
"""

from dataclasses import dataclass, field
from typing import Literal

from pydantic import BaseModel, ConfigDict

from app.schemas.cards import FieldRowLabel
from app.schemas.common import PageType, RateBasis, RiskCategory, Severity
from app.services.pages import Page, PreparedSection


class LlmOutput(BaseModel):
    model_config = ConfigDict(extra="ignore")


class QuoteRef(LlmOutput):
    section_id: str
    text: str


QuestionKind = Literal[
    "this_company", "comparison", "general", "company_public", "personal", "other"
]


class AskPageAnswer(LlmOutput):
    # First, so the model sorts the question before it answers: the kind decides whether
    # Iris searches the web by itself.
    question_kind: QuestionKind
    web_query: str | None
    answer_type: Literal["from_page", "not_on_page"]
    say: str
    lead: str
    topic: str
    quote: QuoteRef | None
    related_risk_ids: list[str]
    agent_notes: str


class FieldHelpRow(LlmOutput):
    label: FieldRowLabel
    value: str


class FieldHelp(LlmOutput):
    say: str
    lead: str
    rows: list[FieldHelpRow]
    example: str | None
    agent_notes: str


class PageSummary(LlmOutput):
    say: str
    lead: str
    bullets: list[str]
    agent_notes: str


class Finding(LlmOutput):
    category: RiskCategory
    severity: Severity
    title: str
    detail: str
    quote: str
    section_id: str
    nudge_phrase: str


class ScanFindings(LlmOutput):
    items: list[Finding]


class WebAnswer(LlmOutput):
    say: str
    lead: str
    bullets: list[str]
    used_sources: list[int]
    agent_notes: str


class WalkthroughLine(LlmOutput):
    key: str
    say: str


class WalkthroughLines(LlmOutput):
    steps: list[WalkthroughLine]


class JourneySummary(LlmOutput):
    summary: str


class ScamReports(LlmOutput):
    fraud_report_indexes: list[int]


class LoanTerms(LlmOutput):
    principal_inr: float | None
    rate_percent: float | None
    rate_basis: RateBasis | None
    tenure_months: int | None
    processing_fee_inr: float | None
    processing_fee_percent: float | None
    gst_percent_on_fee: float | None


class PageTypeAnswer(LlmOutput):
    page_type: PageType


# --- What the fake LLM gets instead of a prompt ---


@dataclass(frozen=True)
class AskPageFake:
    question: str
    page: Page
    pointed_section_id: str | None = None
    # ("p1", page) for each earlier page given to the model, newest first.
    earlier: list[tuple[str, Page]] = field(default_factory=list)


@dataclass(frozen=True)
class FieldHelpFake:
    label: str
    help_text: str | None
    placeholder: str | None
    from_web: bool


@dataclass(frozen=True)
class SectionsFake:
    sections: list[PreparedSection]


@dataclass(frozen=True)
class SearchHitFake:
    title: str
    content: str


@dataclass(frozen=True)
class WebAnswerFake:
    query: str
    results: list[SearchHitFake]
    on_page: bool


@dataclass(frozen=True)
class WalkthroughFake:
    #: (key, text): each step's key and the text the fake answer comes from.
    steps: list[tuple[str, str]]


@dataclass(frozen=True)
class JourneyFake:
    facts: list[str]
    previous_summary: str | None


@dataclass(frozen=True)
class TextFake:
    text: str
