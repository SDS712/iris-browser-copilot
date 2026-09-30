"""Shared enums and small shapes."""

from typing import Literal

from pydantic import BaseModel, ConfigDict

PageType = Literal["terms", "privacy", "checkout", "form", "offer", "article", "other"]
RiskCategory = Literal[
    "costs_money",
    "auto_debit",
    "shares_data",
    "hard_to_cancel",
    "auto_renews",
    "limits_rights",
    "worth_knowing",
]
Severity = Literal["high", "medium", "info"]
ClientRule = Literal[
    "prechecked_paid_addon",
    "prechecked_marketing_consent",
    "late_price",
    "trial_to_paid",
    "flat_rate_offer",
    "countdown_timer",
    "hidden_cookie_reject",
]
CardSource = Literal["page", "web", "calculated", "not_found"]
ScanKind = Literal["terms", "privacy", "checkout", "offer", "general"]
ScanStatus = Literal["pending", "ready", "failed", "none"]
RateBasis = Literal["flat_monthly", "flat_annual", "reducing_annual"]

# Rupee amounts: whole numbers stay integers on the wire.
Amount = int | float


class OutputModel(BaseModel):
    """Base for response shapes: fields with defaults are still required in the schema."""

    model_config = ConfigDict(json_schema_serialization_defaults_required=True)


class Source(OutputModel):
    title: str
    url: str
    domain: str


class RiskFlag(OutputModel):
    id: str
    key: str
    category: RiskCategory
    severity: Severity
    title: str
    detail: str
    quote: str | None
    section_id: str | None
    element_ids: list[str]
    amount_inr: Amount | None
    origin: Literal["client_rule", "page_text"]
