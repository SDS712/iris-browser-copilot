"""Loan terms read from page text with regular expressions (no model).

Used by loan_cost, the flat-rate nudge and the fake loan_extract task.
"""

import re
from dataclasses import dataclass, replace

from app.schemas.common import RateBasis
from app.services.calc import LoanInput
from app.services.pages import Page

_NUM = r"(\d+(?:\.\d+)?)"
_MONTHLY = r"(?:p\.?\s?m\.?|per\s+month|a\s+month|monthly|/\s?month)"
_YEARLY = r"(?:p\.?\s?a\.?|per\s+annum|per\s+year|a\s+year|yearly|annual(?:ly)?|/\s?year)"
_FLAT_RATE_RE = re.compile(
    rf"{_NUM}\s?%\s*(?P<unit>{_MONTHLY}|{_YEARLY})?\s*(?:,\s*)?flat"
    rf"|flat\s+(?:rate\s+(?:of\s+)?)?{_NUM}\s?%\s*(?P<unit2>{_MONTHLY}|{_YEARLY})?",
    re.IGNORECASE,
)
_REDUCING_RE = re.compile(
    rf"{_NUM}\s?%\s*(?:{_YEARLY})\s*(?:reducing|interest|rate)?", re.IGNORECASE
)
_TENURE_RE = re.compile(
    r"(\d{1,3})\s*(?:monthly\s+)?(?:instal?ments|months|emis|equated\s+monthly)\b", re.IGNORECASE
)
_FEE_INR_RE = re.compile(
    r"processing\s+fee[^.%₹\d]{0,40}(?:₹|rs\.?|inr)\s?(\d[\d,]*(?:\.\d+)?)", re.IGNORECASE
)
_FEE_PERCENT_RE = re.compile(
    r"processing\s+fee[^.%₹\d]{0,40}(?:\(?\s*)?(\d+(?:\.\d+)?)\s?%", re.IGNORECASE
)
_FEE_PERCENT_IN_BRACKETS_RE = re.compile(
    r"processing\s+fee[^.]{0,60}?\(\s*(\d+(?:\.\d+)?)\s?%", re.IGNORECASE
)
_GST_RATE_RE = re.compile(
    r"(\d+(?:\.\d+)?)\s?%\s*gst|gst\s*(?:@|at|of)\s*(\d+(?:\.\d+)?)\s?%", re.IGNORECASE
)
_FEE_GST_RE = re.compile(r"processing\s+fee[^.]{0,80}\bgst\b", re.IGNORECASE)


@dataclass(frozen=True)
class LoanFacts:
    principal_inr: float | None = None
    rate_percent: float | None = None
    rate_basis: RateBasis | None = None
    tenure_months: int | None = None
    processing_fee_inr: float | None = None
    processing_fee_percent: float | None = None
    gst_percent_on_fee: float | None = None
    mentions_gst_on_fee: bool = False

    def loan_input(self) -> LoanInput | None:
        """Inputs for calc.py, or None while anything required is missing."""
        if (
            self.principal_inr is None
            or self.rate_percent is None
            or self.rate_basis is None
            or self.tenure_months is None
        ):
            return None
        return LoanInput(
            principal=self.principal_inr,
            rate_percent=self.rate_percent,
            rate_basis=self.rate_basis,
            tenure_months=self.tenure_months,
            processing_fee_inr=self.processing_fee_inr,
            processing_fee_percent=self.processing_fee_percent,
            gst_percent_on_fee=self.gst_percent_on_fee,
        )

    def merged_with(self, other: "LoanFacts") -> "LoanFacts":
        """Fill this one's missing values from `other`."""
        updates = {
            name: getattr(other, name)
            for name in (
                "principal_inr",
                "rate_percent",
                "rate_basis",
                "tenure_months",
                "processing_fee_inr",
                "processing_fee_percent",
                "gst_percent_on_fee",
            )
            if getattr(self, name) is None and getattr(other, name) is not None
        }
        merged = replace(self, **updates)
        return replace(
            merged, mentions_gst_on_fee=self.mentions_gst_on_fee or other.mentions_gst_on_fee
        )


def _number(text: str) -> float:
    return float(text.replace(",", ""))


def _basis(unit: str | None, flat: bool) -> RateBasis | None:
    yearly = bool(unit and re.fullmatch(_YEARLY, unit.strip(), re.IGNORECASE))
    if flat:
        return "flat_annual" if yearly else "flat_monthly"
    return "reducing_annual" if yearly else None


def extract(text: str) -> LoanFacts:
    """Loan terms written in the text. Numbers are copied, never calculated."""
    rate = basis = None
    flat = _FLAT_RATE_RE.search(text)
    if flat:
        rate = _number(flat.group(1) or flat.group(3))
        basis = _basis(flat.group("unit") or flat.group("unit2"), flat=True)
    else:
        reducing = _REDUCING_RE.search(text)
        if reducing:
            rate, basis = _number(reducing.group(1)), "reducing_annual"

    tenure_match = _TENURE_RE.search(text)
    fee_inr = _FEE_INR_RE.search(text)
    fee_percent = _FEE_PERCENT_RE.search(text) or _FEE_PERCENT_IN_BRACKETS_RE.search(text)
    gst = _GST_RATE_RE.search(text)
    return LoanFacts(
        rate_percent=rate,
        rate_basis=basis,
        tenure_months=int(tenure_match.group(1)) if tenure_match else None,
        processing_fee_inr=_number(fee_inr.group(1)) if fee_inr else None,
        processing_fee_percent=_number(fee_percent.group(1)) if fee_percent else None,
        gst_percent_on_fee=_number(gst.group(1) or gst.group(2)) if gst else None,
        mentions_gst_on_fee=bool(_FEE_GST_RE.search(text)),
    )


def offer_text(page: Page) -> str:
    return "\n".join(section.text for section in page.sections)


def from_page(page: Page) -> LoanFacts:
    """Flag params first, then the page text, then the largest price near the offer."""
    facts = LoanFacts()
    for flag in page.snapshot.client_flags:
        if flag.rule != "flat_rate_offer":
            continue
        params = flag.params
        facts = LoanFacts(
            principal_inr=_float(params.get("principal_inr")),
            rate_percent=_float(params.get("rate_percent")),
            rate_basis=_rate_basis(params.get("rate_basis")),
            tenure_months=_int(params.get("tenure_months")),
        )
        break
    facts = facts.merged_with(extract(offer_text(page)))
    if facts.principal_inr is None:
        facts = replace(facts, principal_inr=largest_price(page))
    return facts


def largest_price(page: Page) -> float | None:
    """The biggest price on the page, preferring prices written in the offer's own section."""
    offer_sections = [s.text for s in page.sections if _FLAT_RATE_RE.search(s.text)]
    amounts = [p for p in page.snapshot.prices if p.amount_inr is not None]
    near = [p for p in amounts if any(p.amount_text in text for text in offer_sections)]
    pool = near or amounts
    return float(max(p.amount_inr for p in pool if p.amount_inr is not None)) if pool else None


def appears_in(text: str, value: float) -> bool:
    """Whether a number is written in the text (commas ignored), e.g. 59999 in '₹59,999'."""
    plain = text.replace(",", "")
    written = f"{value:g}"
    candidates = {written, f"{value:.2f}"}
    if float(value).is_integer():
        candidates.add(str(int(value)))
    return any(re.search(rf"(?<![\d.]){re.escape(c)}(?![\d])", plain) for c in candidates)


def _float(value: object) -> float | None:
    return float(value) if isinstance(value, int | float) else None


def _int(value: object) -> int | None:
    return int(value) if isinstance(value, int | float) else None


def _rate_basis(value: object) -> RateBasis | None:
    if value == "flat_monthly":
        return "flat_monthly"
    if value == "flat_annual":
        return "flat_annual"
    if value == "reducing_annual":
        return "reducing_annual"
    return None
