"""The Card union."""

from typing import Annotated, Literal

from pydantic import Field

from app.schemas.common import Amount, CardSource, OutputModel, RiskFlag


class CardBase(OutputModel):
    topic: str
    source: CardSource
    lead: str


class AnswerQuote(OutputModel):
    text: str
    section_id: str
    section_heading: str | None
    # Set when the quote comes from an earlier page in the tab; null for the current page.
    page_title: str | None = None
    page_url: str | None = None


class AnswerCard(CardBase):
    kind: Literal["answer"] = "answer"
    quote: AnswerQuote | None
    risks: list[RiskFlag]


FieldRowLabel = Literal["What it is", "Where to find it", "Format", "Common mistake"]


class FieldRow(OutputModel):
    label: FieldRowLabel
    value: str


class FieldCard(CardBase):
    kind: Literal["field"] = "field"
    field_id: str | None
    rows: list[FieldRow]
    example: str | None


class RiskListCard(CardBase):
    kind: Literal["risk_list"] = "risk_list"
    risks: list[RiskFlag]


class SummaryCard(CardBase):
    kind: Literal["summary"] = "summary"
    bullets: list[str]


class WebAnswerCard(CardBase):
    kind: Literal["web_answer"] = "web_answer"
    bullets: list[str]


class TrueCostCard(CardBase):
    kind: Literal["true_cost"] = "true_cost"
    figure_text: str
    apr_percent: float
    effective_annual_percent: float
    advertised: str
    emi_inr: Amount
    tenure_months: int
    total_paid_inr: Amount
    fees_upfront_inr: Amount
    extra_over_price_inr: Amount
    explanation: list[str]


class TrustReason(OutputModel):
    text: str
    level: Literal["good", "warn", "bad"]


class TrustCard(CardBase):
    kind: Literal["trust"] = "trust"
    verdict: Literal["looks_ok", "be_careful", "likely_unsafe"]
    domain: str
    reasons: list[TrustReason]
    checks_line: str


Card = Annotated[
    AnswerCard | FieldCard | RiskListCard | SummaryCard | WebAnswerCard | TrueCostCard | TrustCard,
    Field(discriminator="kind"),
]
