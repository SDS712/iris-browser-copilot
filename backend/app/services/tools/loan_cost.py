"""loan_cost: the true yearly cost of an offer. Every figure comes from calc.py."""

import re

from app.errors import ErrorCode, IrisError
from app.schemas.api import LoanCostRequest, ToolResult
from app.schemas.cards import TrueCostCard
from app.services import calc, loan_text, templates
from app.services.container import Services
from app.services.llm import FAST_TIMEOUT, LlmTask, build_messages
from app.services.llm_tasks import LoanTerms, TextFake
from app.services.loan_text import LoanFacts, appears_in
from app.services.money import format_inr, number_value
from app.services.pages import Page
from app.services.tools.common import tool_result

MAX_EXTRACT_CHARS = 8_000
_OFFER_WORDS_RE = re.compile(
    r"emi|instal|interest|flat|p\.?\s?m\.?|per month|loan|processing fee|tenure|months",
    re.IGNORECASE,
)
REQUIRED = (
    ("principal_inr", "the loan amount"),
    ("rate_percent", "the interest rate"),
    ("rate_basis", "whether the rate is flat or reducing"),
    ("tenure_months", "the number of months"),
)
_NUMBER_FIELDS = (
    "principal_inr",
    "rate_percent",
    "tenure_months",
    "processing_fee_inr",
    "processing_fee_percent",
    "gst_percent_on_fee",
)


def missing(facts: LoanFacts) -> list[str]:
    return [name for field, name in REQUIRED if getattr(facts, field) is None]


def joined(names: list[str]) -> str:
    return names[0] if len(names) == 1 else ", ".join(names[:-1]) + " and " + names[-1]


def page_text(page: Page) -> str:
    snapshot = page.snapshot
    parts = [section.text for section in page.sections]
    parts += [price.amount_text for price in snapshot.prices]
    parts += [choice.label for choice in snapshot.checkboxes]
    return "\n".join(parts)


async def extract_with_model(services: Services, page: Page) -> LoanFacts:
    """The fast model reads the offer text; numbers not written on the page are dropped."""
    offer = [s.text for s in page.sections if _OFFER_WORDS_RE.search(s.text)] or [
        s.text for s in page.sections
    ]
    text = "\n\n".join(offer)[:MAX_EXTRACT_CHARS]
    if not text:
        return LoanFacts()
    task = LlmTask(
        name="loan_terms",
        output=LoanTerms,
        model=services.settings.llm_model_fast,
        purpose="loan_extract",
        messages=build_messages("loan_extract", f"{page.header()}\n\nOFFER TEXT:\n{text}"),
        max_tokens=300,
        timeout=FAST_TIMEOUT,
        fake_input=TextFake(text),
    )
    terms = await services.llm.complete(task)
    written = page_text(page)
    kept = {
        name: value
        for name in _NUMBER_FIELDS
        if (value := getattr(terms, name)) is not None and appears_in(written, float(value))
    }
    return LoanFacts(
        principal_inr=kept.get("principal_inr"),
        rate_percent=kept.get("rate_percent"),
        rate_basis=terms.rate_basis if "rate_percent" in kept else None,
        tenure_months=int(kept["tenure_months"]) if "tenure_months" in kept else None,
        processing_fee_inr=kept.get("processing_fee_inr"),
        processing_fee_percent=kept.get("processing_fee_percent"),
        gst_percent_on_fee=kept.get("gst_percent_on_fee"),
    )


def request_facts(request: LoanCostRequest) -> LoanFacts:
    return LoanFacts(
        principal_inr=float(request.principal_inr) if request.principal_inr is not None else None,
        rate_percent=request.rate_percent,
        rate_basis=request.rate_basis,
        tenure_months=request.tenure_months,
        processing_fee_inr=float(request.processing_fee_inr)
        if request.processing_fee_inr is not None
        else None,
        processing_fee_percent=request.processing_fee_percent,
        gst_percent_on_fee=request.gst_percent_on_fee,
    )


async def loan_cost(services: Services, request: LoanCostRequest) -> ToolResult:
    facts = request_facts(request)
    if request.page_id:
        page = services.pages.get(request.page_id)
        facts = facts.merged_with(loan_text.from_page(page))
        if missing(facts):
            facts = facts.merged_with(await extract_with_model(services, page))
    loan = facts.loan_input()
    if loan is None:
        need = joined(missing(facts))
        raise IrisError(
            ErrorCode.INVALID_REQUEST,
            f"I need {need} to work this out.",
            agent_message=f"I need {need} to work this out. Ask the user, or check the fine print.",
        )
    result = calc.calculate(loan)
    return tool_result_for(services, loan, result, facts)


def tool_result_for(
    services: Services, loan: calc.LoanInput, result: calc.LoanResult, facts: LoanFacts
) -> ToolResult:
    advertised = templates.advertised_rate(loan.rate_percent, loan.rate_basis)
    apr = round(result.apr_percent, 1)
    principal = format_inr(loan.principal)
    total = format_inr(round(result.total_paid))
    extra = format_inr(round(result.extra_over_price))
    if loan.rate_basis.startswith("flat"):
        first = (
            f"Interest is charged on the full {principal} for all {loan.tenure_months} months, "
            "even as you pay it back."
        )
    else:
        first = "Interest is charged only on what you still owe each month."
    if result.upfront:
        second = (
            f"You pay {total} in instalments plus {format_inr(result.upfront)} in fees upfront: "
            f"{extra} on top of {principal}."
        )
    else:
        second = f"You pay {total} in instalments: {extra} on top of {principal}."
    explanation = [first, second]
    gst_unstated = (
        facts.mentions_gst_on_fee
        and facts.gst_percent_on_fee is None
        and facts.processing_fee_inr is None
        and facts.processing_fee_percent is not None
    )
    if gst_unstated:
        explanation.append(templates.GST_NOT_STATED)
    fees_counted = " once the fees are counted" if result.upfront else ""
    lead = (
        f"{advertised} works out to about {apr:.1f}% a year{fees_counted}. "
        f"The EMI is {format_inr(round(result.emi))} for {loan.tenure_months} months."
    )
    card = TrueCostCard(
        topic="True cost of offer",
        source="calculated",
        lead=lead,
        figure_text=f"≈ {apr:.1f}% a year",
        apr_percent=apr,
        effective_annual_percent=round(result.effective_annual_percent, 1),
        advertised=advertised,
        emi_inr=number_value(round(result.emi)),
        tenure_months=loan.tenure_months,
        total_paid_inr=number_value(round(result.total_paid)),
        fees_upfront_inr=number_value(result.upfront),
        extra_over_price_inr=number_value(round(result.extra_over_price)),
        explanation=explanation,
    )
    notes = (
        f"EMI {format_inr(result.emi, paise=True)}; "
        f"interest {format_inr(result.interest, paise=True)}; "
        f"total of instalments {format_inr(result.total_paid, paise=True)}; fees upfront "
        f"{format_inr(result.upfront)}; nominal yearly rate {apr:.1f}%; effective yearly rate "
        f"{result.effective_annual_percent:.1f}%."
    )
    return tool_result(
        services.settings,
        say=templates.loan_say(advertised, loan.rate_basis, apr),
        card=card,
        agent_notes=notes,
    )
