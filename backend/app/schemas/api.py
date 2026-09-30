"""Request and response bodies for the HTTP API."""

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.cards import Card
from app.schemas.common import (
    Amount,
    OutputModel,
    PageType,
    RateBasis,
    RiskFlag,
    ScanKind,
    ScanStatus,
    Source,
)
from app.schemas.snapshot import PageSnapshot


class ContractModel(OutputModel):
    """Base for response bodies: every one carries contract_version 1."""

    contract_version: Literal[1] = 1


class RequestModel(BaseModel):
    """Base for request bodies: unknown fields are rejected."""

    model_config = ConfigDict(extra="forbid")


# --- Errors ---


class ErrorBody(BaseModel):
    """retry_after_seconds is left out when there's no wait to suggest."""

    code: str
    message: str
    agent_message: str
    retry_after_seconds: int | None = None


class ErrorEnvelope(ContractModel):
    error: ErrorBody


# --- Health ---

ServiceReason = Literal["daily_cap", "total_cap", "paused"]


class ServiceState(OutputModel):
    open: bool
    reason: ServiceReason | None


class HealthResponse(ContractModel):
    status: Literal["ok"] = "ok"
    version: str
    service: ServiceState


# --- Voice ---


class AudioFormat(OutputModel):
    encoding: Literal["audio/pcm"] = "audio/pcm"


class SessionInput(OutputModel):
    format: AudioFormat
    keyterms: list[str]


class SessionOutput(OutputModel):
    voice: str
    format: AudioFormat


class AgentSession(BaseModel):
    """The body of AssemblyAI's session.update event, sent by the client unchanged."""

    system_prompt: str
    greeting: str | None = Field(default=None, description="Left out when greet=false.")
    input: SessionInput
    output: SessionOutput
    tools: list[dict[str, Any]]


class AgentConfigResponse(ContractModel):
    session: AgentSession
    max_session_seconds: int
    warn_before_end_seconds: int


class VoiceTokenResponse(ContractModel):
    token: str
    expires_in_seconds: int
    max_session_seconds: int


# --- Pages ---


class CreatePageRequest(RequestModel):
    snapshot: PageSnapshot


class ScanBrief(OutputModel):
    status: ScanStatus
    kind: ScanKind | None


class CreatePageResponse(ContractModel):
    page_id: str
    page_type: PageType
    summary_for_agent: str
    scan: ScanBrief
    # Signs the site deserves a trust check, e.g. "lookalike:sbi.co.in".
    site_signals: list[str] = Field(default_factory=list)


class ScanCounts(OutputModel):
    high: int
    medium: int
    info: int


class Nudge(OutputModel):
    say: str
    risk_ids: list[str]
    risk_keys: list[str]
    highlight_ids: list[str]


class ScanResult(ContractModel):
    page_id: str
    status: ScanStatus
    kind: ScanKind | None
    risks: list[RiskFlag]
    counts: ScanCounts
    nudge: Nudge | None


# --- Tools ---


class ToolResult(ContractModel):
    say: str
    agent_notes: str
    card: Card | None
    highlight_ids: list[str]
    quote_text: str | None
    sources: list[Source]
    not_found: bool


class PointerHint(RequestModel):
    """What the user last pointed at or focused on the page: element IDs only."""

    field_id: str | None = None
    price_id: str | None = None
    section_id: str | None = None


class ExplainFieldRequest(RequestModel):
    page_id: str
    field_id: str | None = None
    field_label: str | None = Field(default=None, max_length=200)
    pointer: PointerHint | None = None


class AskPageRequest(RequestModel):
    page_id: str
    question: str = Field(min_length=1, max_length=500)
    pointer: PointerHint | None = None
    # Pages visited before this one in the same tab, newest first.
    earlier_page_ids: list[str] = Field(default_factory=list, max_length=9)


class SummarizeRequest(RequestModel):
    page_id: str
    style: Literal["quick", "detailed"] = "quick"
    focus: str | None = Field(default=None, max_length=200)


class ScanRequest(RequestModel):
    page_id: str
    kind: ScanKind | None = None


class SiteTrustRequest(RequestModel):
    url: str = Field(min_length=1, max_length=2048)


class WebLookupRequest(RequestModel):
    query: str = Field(min_length=1, max_length=300)
    page_id: str | None = None


class FormStep(RequestModel):
    """One step of a form walkthrough: a part of the form, or one field."""

    key: str = Field(min_length=1, max_length=80)
    heading: str | None = Field(default=None, max_length=200)
    element_ids: list[Annotated[str, Field(max_length=40)]] = Field(min_length=1, max_length=20)


class WalkthroughRequest(RequestModel):
    """Up to 5 page sections, or up to 5 form steps, in page order."""

    page_id: str
    section_ids: list[Annotated[str, Field(max_length=40)]] = Field(
        default_factory=list, max_length=5
    )
    form_steps: list[FormStep] = Field(default_factory=list, max_length=5)

    @model_validator(mode="after")
    def one_kind(self) -> "WalkthroughRequest":
        if bool(self.section_ids) == bool(self.form_steps):
            raise ValueError("Give either section_ids or form_steps.")
        return self


class WalkthroughStep(OutputModel):
    #: The section's ID in a page walkthrough; the step's key in a form walkthrough.
    key: str
    heading: str | None
    say: str
    risk_ids: list[str]


class WalkthroughResponse(ContractModel):
    steps: list[WalkthroughStep]


class JourneySummaryRequest(RequestModel):
    """The trail's fact lines, oldest first, and the summary so far."""

    facts: list[Annotated[str, Field(max_length=600)]] = Field(min_length=1, max_length=10)
    previous_summary: str | None = Field(default=None, max_length=2000)


class JourneySummaryResponse(ContractModel):
    summary: str


class LoanCostRequest(RequestModel):
    page_id: str | None = None
    principal_inr: Amount | None = None
    rate_percent: float | None = None
    rate_basis: RateBasis | None = None
    tenure_months: int | None = None
    processing_fee_inr: Amount | None = None
    processing_fee_percent: float | None = None
    gst_percent_on_fee: float | None = None
    fees_deducted_upfront: bool = True
