"""The page snapshot. Field values never appear here: only `filled`."""

from typing import Literal

from pydantic import BaseModel, ConfigDict

from app.schemas.common import Amount, ClientRule, PageType, RiskCategory, Severity


class SnapshotModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PageField(SnapshotModel):
    id: str
    label: str
    type: Literal[
        "text", "email", "tel", "number", "date", "select", "textarea", "password", "other"
    ]
    required: bool
    placeholder: str | None
    help_text: str | None
    section: str | None
    options: list[str]
    filled: bool
    sensitive: bool


class Choice(SnapshotModel):
    id: str
    label: str
    kind: Literal["checkbox", "radio"]
    group: str | None
    checked: bool
    prechecked: bool
    amount_inr: Amount | None
    first_seen_revision: int


class Button(SnapshotModel):
    id: str
    text: str
    kind: Literal["button", "submit", "link"]
    disabled: bool


class Price(SnapshotModel):
    id: str
    label: str | None
    amount_text: str
    amount_inr: Amount | None
    first_seen_revision: int


class Section(SnapshotModel):
    id: str
    heading: str | None
    level: int | None
    text: str


class LegalLink(SnapshotModel):
    id: str
    text: str
    href: str


class CookieBanner(SnapshotModel):
    id: str
    accept_button_id: str | None
    reject_button_id: str | None
    manage_button_id: str | None
    reject_visible: bool


class ClientFlag(SnapshotModel):
    rule: ClientRule
    category: RiskCategory
    severity: Severity
    element_ids: list[str]
    detail: str
    amount_inr: Amount | None
    params: dict[str, int | float | str]


class PageSnapshot(SnapshotModel):
    contract_version: Literal[1]
    url: str
    title: str
    lang: str | None
    page_type_hint: PageType
    revision: int
    captured_at: str
    truncated: bool
    fields: list[PageField]
    checkboxes: list[Choice]
    buttons: list[Button]
    prices: list[Price]
    sections: list[Section]
    legal_links: list[LegalLink]
    cookie_banner: CookieBanner | None
    client_flags: list[ClientFlag]
