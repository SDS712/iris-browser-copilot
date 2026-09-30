"""Fake LLM for IRIS_FAKE_UPSTREAMS=1: deterministic answers built from the page.

It still checks the caps and records usage of (input characters ÷ 4) tokens,
so the ledger is exercised in tests.
"""

import json
import re
from collections.abc import Callable
from functools import cache
from pathlib import Path
from typing import Any

from pydantic import BaseModel

from app.pricing import llm_cost_usd
from app.schemas.common import RiskCategory, Severity
from app.services.budget import Budget
from app.services.llm import LlmTask, estimate_cost, price_or_refuse
from app.services.llm_tasks import (
    AskPageAnswer,
    AskPageFake,
    FieldHelp,
    FieldHelpFake,
    FieldHelpRow,
    Finding,
    JourneyFake,
    JourneySummary,
    LoanTerms,
    PageSummary,
    PageTypeAnswer,
    QuestionKind,
    QuoteRef,
    ScamReports,
    ScanFindings,
    SectionsFake,
    TextFake,
    WalkthroughFake,
    WalkthroughLine,
    WalkthroughLines,
    WebAnswer,
    WebAnswerFake,
)
from app.services.loan_text import extract
from app.services.pages import Page, shared_words

GLOSSARY_PATH = Path(__file__).with_name("fake_glossary.json")
ASK_PAGE_MIN_SCORE = 1.0
_SENTENCE_RE = re.compile(r"(?<=[.!?])\s+")
_NUMBERING_RE = re.compile(r"^\s*\d+(\.\d+)*[.)]?\s+")
_GENERAL_RE = re.compile(
    r"\b(what is|what's an?|what does|meaning|rbi|law|legal|rules?|usually)\b",
    re.IGNORECASE,
)
_COMPARISON_RE = re.compile(r"\b(normal|typical|fair|allowed)\b", re.IGNORECASE)
_POINTING_RE = re.compile(r"\b(this|that|here)\b", re.IGNORECASE)


def first_sentence(text: str) -> str:
    return _SENTENCE_RE.split(text.strip(), maxsplit=1)[0]


def topic_from_heading(heading: str | None) -> str:
    words = _NUMBERING_RE.sub("", heading or "Page").split()
    return " ".join(words[:3]) or "Page"


def fake_question_kind(question: str) -> tuple[QuestionKind, str | None]:
    """Comparisons and general questions come with a web query; anything else is this site's."""
    if _COMPARISON_RE.search(question):
        return "comparison", question.strip(" ?")
    if _GENERAL_RE.search(question):
        return "general", question.strip(" ?")
    return "this_company", None


def fake_ask_page(data: AskPageFake) -> AskPageAnswer:
    # "What does this mean?" with the pointer on a section answers from that section.
    pointed = data.pointed_section_id if _POINTING_RE.search(data.question) else None
    # The best match across the current page and the earlier pages it was given.
    matches = [
        (score, "", data.page, chunk.section_id)
        for chunk, score in data.page.index.search(data.question, top_k=1)
    ]
    for key, page in data.earlier:
        matches += [
            (score, f"{key}:", page, chunk.section_id)
            for chunk, score in page.index.search(data.question, top_k=1)
        ]
    if not any(score >= ASK_PAGE_MIN_SCORE for score, *_ in matches):
        # Pages too small for BM25: the section sharing most of the question's words.
        for key, page in [("", data.page), *((f"{k}:", p) for k, p in data.earlier)]:
            matches += [
                (float(shared_words(data.question, section)) / 2, key, page, section.id)
                for section in page.sections
            ]
    best = max(matches, key=lambda match: match[0], default=None)
    target: tuple[str, Page, str] | None = None
    if pointed:
        target = ("", data.page, pointed)
    elif best is not None and best[0] >= ASK_PAGE_MIN_SCORE:
        target = best[1:]
    kind, web_query = fake_question_kind(data.question)
    if target is None:
        offer = "" if web_query else " Want me to look it up?"
        return AskPageAnswer(
            question_kind=kind,
            web_query=web_query,
            answer_type="not_on_page",
            say=f"The page doesn't mention that.{offer}",
            lead="The page doesn't mention this.",
            topic="Not on page",
            quote=None,
            related_risk_ids=[],
            agent_notes="",
        )
    prefix, page, section_id = target
    section = page.section_by_id[section_id]
    sentence = first_sentence(section.text)
    words = " ".join(sentence.split()[:20])
    return AskPageAnswer(
        question_kind=kind,
        web_query=web_query,
        answer_type="from_page",
        say=f"The page says: {words}",
        lead=sentence,
        topic=topic_from_heading(section.heading),
        quote=QuoteRef(section_id=f"{prefix}{section.id}", text=sentence),
        related_risk_ids=[],
        agent_notes="",
    )


def fake_walkthrough(data: WalkthroughFake) -> WalkthroughLines:
    """The first 20 words of each step's text's first sentence."""
    return WalkthroughLines(
        steps=[
            WalkthroughLine(key=key, say=" ".join(first_sentence(text).split()[:20]))
            for key, text in data.steps
        ]
    )


def fake_journey_summary(data: JourneyFake) -> JourneySummary:
    """The previous summary and the fact lines, joined and cut to the prompt's limit."""
    parts = [data.previous_summary or "", *data.facts]
    return JourneySummary(summary=" ".join(part for part in parts if part)[:1200])


@cache
def glossary() -> dict[str, dict[str, Any]]:
    data: dict[str, dict[str, Any]] = json.loads(GLOSSARY_PATH.read_text(encoding="utf-8"))
    return data


def fake_field_help(data: FieldHelpFake) -> FieldHelp:
    label = data.label.lower()
    entry = next(
        (value for key, value in glossary().items() if re.search(rf"\b{re.escape(key)}\b", label)),
        None,
    )
    if entry is None:
        entry = {
            "say": f"This asks for your {data.label}.",
            "rows": {
                "What it is": f"The {data.label} this form asks for.",
                "Where to find it": "Check your documents or the page's own help text.",
                "Format": data.placeholder or "As shown on the form.",
            },
            "example": None,
        }
    rows = [FieldHelpRow(label=key, value=value) for key, value in entry["rows"].items()]
    return FieldHelp(
        say=entry["say"],
        lead=entry["rows"]["What it is"],
        rows=rows,
        example=entry.get("example"),
        agent_notes=data.help_text or "",
    )


def fake_summary(data: SectionsFake) -> PageSummary:
    bullets = [first_sentence(section.text) for section in data.sections[:5] if section.text]
    first = bullets[0] if bullets else "This page has very little text."
    return PageSummary(
        say=f"Here's the gist. {first} Want more detail?",
        lead=" ".join(bullets[:2]) or first,
        bullets=bullets,
        agent_notes="",
    )


# Keyword rules for fake scans: (pattern, category, severity, title, detail, nudge phrase).
SCAN_RULES: tuple[tuple[str, RiskCategory, Severity, str, str, str], ...] = (
    (
        r"auto-?debit|\bnach\b|\bmandate\b|autopay",
        "auto_debit",
        "high",
        "Repayments are auto-debited",
        "Payments are collected automatically from your bank account.",
        "this sets up an auto-debit from your bank account",
    ),
    (
        r"foreclosure|prepayment",
        "costs_money",
        "medium",
        "Fee to repay early",
        "Closing the loan early costs extra.",
        "there's a fee if you repay early",
    ),
    (
        r"late fee|bounce",
        "costs_money",
        "medium",
        "Charges for late or failed payments",
        "Missed or failed payments add charges.",
        "missed payments cost extra",
    ),
    (
        r"arbitration",
        "limits_rights",
        "medium",
        "Disputes go to arbitration",
        "Disputes are decided by an arbitrator instead of a court.",
        "disputes go to an arbitrator instead of a court",
    ),
    (
        r"shar\w*\b.{0,80}\b(partners|affiliates)",
        "shares_data",
        "medium",
        "Shares your data with partners",
        "Your information can be shared with partners and affiliates.",
        "your data is shared with partners",
    ),
    (
        r"auto-?renew|\brenews\b",
        "auto_renews",
        "medium",
        "Renews automatically",
        "A plan renews on its own unless you cancel.",
        "a plan renews automatically unless you cancel",
    ),
    (
        r"cancel\w*\b.{0,80}\bnotice",
        "hard_to_cancel",
        "medium",
        "Cancelling needs notice",
        "You have to give notice before you can cancel.",
        "cancelling needs advance notice",
    ),
)


def fake_scan(data: SectionsFake) -> ScanFindings:
    findings = []
    for pattern, category, severity, title, detail, phrase in SCAN_RULES:
        regex = re.compile(pattern, re.IGNORECASE)
        for section in data.sections:
            if section.heading and "definition" in section.heading.lower():
                continue
            sentence = next((s for s in _SENTENCE_RE.split(section.text) if regex.search(s)), None)
            if sentence:
                findings.append(
                    Finding(
                        category=category,
                        severity=severity,
                        title=title,
                        detail=detail,
                        quote=sentence,
                        section_id=section.id,
                        nudge_phrase=phrase,
                    )
                )
                break
    return ScanFindings(items=findings)


def fake_web_answer(data: WebAnswerFake) -> WebAnswer:
    opener = "That isn't on the page, so I looked it up." if data.on_page else "I looked it up."
    first = data.results[0].content if data.results else ""
    return WebAnswer(
        say=f"{opener} {first_sentence(first)} The sources are on the card.",
        lead=first_sentence(first),
        bullets=[first_sentence(hit.content) for hit in data.results[:4]],
        used_sources=list(range(len(data.results))),
        agent_notes="",
    )


def fake_loan_terms(data: TextFake) -> LoanTerms:
    facts = extract(data.text)
    return LoanTerms(
        principal_inr=facts.principal_inr,
        rate_percent=facts.rate_percent,
        rate_basis=facts.rate_basis,
        tenure_months=facts.tenure_months,
        processing_fee_inr=facts.processing_fee_inr,
        processing_fee_percent=facts.processing_fee_percent,
        gst_percent_on_fee=facts.gst_percent_on_fee,
    )


HANDLERS: dict[str, Callable[[Any], BaseModel]] = {
    "ask_page_answer": fake_ask_page,
    "field_help": fake_field_help,
    "page_summary": fake_summary,
    "scan_findings": fake_scan,
    "web_answer": fake_web_answer,
    "scam_reports": lambda _: ScamReports(fraud_report_indexes=[]),
    "loan_terms": fake_loan_terms,
    "page_type": lambda _: PageTypeAnswer(page_type="article"),
    "journey_summary": fake_journey_summary,
    "walkthrough_steps": fake_walkthrough,
}


class FakeLLMClient:
    def __init__(self, budget: Budget) -> None:
        self.budget = budget

    async def complete[T: BaseModel](self, task: LlmTask[T]) -> T:
        price = price_or_refuse(task.model)
        await self.budget.check(estimate_cost(price, task.messages, task.max_tokens))
        output = HANDLERS[task.name](task.fake_input)
        prompt_tokens = sum(len(str(m.get("content", ""))) for m in task.messages) // 4
        completion_tokens = len(output.model_dump_json()) // 4
        await self.budget.record_llm_call(
            task.model,
            task.purpose,
            prompt_tokens,
            0,
            completion_tokens,
            llm_cost_usd(price, prompt_tokens, completion_tokens),
        )
        return task.output.model_validate(output.model_dump())
