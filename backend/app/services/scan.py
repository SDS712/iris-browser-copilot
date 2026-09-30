"""Page scans: client-flag risks, background text scans, merging and nudges."""

import asyncio
import logging
import re
import time
from collections.abc import Callable, Coroutine
from dataclasses import dataclass, field
from typing import Any

from app.errors import IrisError
from app.schemas.api import Nudge, ScanCounts, ScanResult
from app.schemas.common import ClientRule, PageType, RiskFlag, ScanKind, ScanStatus
from app.services import calc, loan_text, templates
from app.services.grounding import MAX_QUOTE_CHARS, find_quote
from app.services.llm import FAST_TIMEOUT, LLMClient, LlmTask, build_messages
from app.services.llm_tasks import Finding, ScanFindings, SectionsFake
from app.services.money import first_rupee_amount
from app.services.pages import Page, PreparedSection
from app.services.say import finalise
from app.services.ttl_cache import TTLCache
from app.settings import Settings

logger = logging.getLogger("iris.scan")

SCANNED_TYPES: dict[PageType, ScanKind] = {
    "terms": "terms",
    "privacy": "privacy",
    "checkout": "checkout",
    "offer": "offer",
}
SEVERITY_ORDER = {"high": 0, "medium": 1, "info": 2}
CATEGORY_ORDER = (
    "costs_money",
    "auto_debit",
    "auto_renews",
    "shares_data",
    "hard_to_cancel",
    "limits_rights",
    "worth_knowing",
)
NUDGE_VERBS: dict[PageType, str] = {"terms": "agree", "privacy": "agree", "checkout": "pay"}
MAX_TEXT_RISKS = 12
PART_CHARS = 20_000
MAX_SCAN_CHARS = 60_000
SCAN_CACHE_SECONDS = 24 * 3600
SCAN_CACHE_SIZE = 500
MAX_NUDGE_WORDS = 25
# Background scans write up to 12 findings; on a short terms page Sonnet 5 took about
# 20 s, so the 25 s interactive limit would cut real pages off. Nobody waits on these.
SCAN_DEEP_TIMEOUT = 45.0


@dataclass
class ScanRisk:
    """A risk plus what the nudge needs; `flag.id` is set when risks are merged."""

    flag: RiskFlag
    nudge_phrase: str | None
    rule: ClientRule | None = None


@dataclass
class ScanState:
    status: ScanStatus
    kind: ScanKind | None
    risks: list[ScanRisk] = field(default_factory=list)
    done: asyncio.Event = field(default_factory=asyncio.Event)


def client_flag_risks(page: Page) -> list[ScanRisk]:
    risks = []
    for flag in page.snapshot.client_flags:
        first = flag.element_ids[0] if flag.element_ids else "page"
        label = page.element_label(first) if flag.element_ids else None
        words = templates.client_flag_words(flag, label)
        risks.append(
            ScanRisk(
                flag=RiskFlag(
                    id="",
                    key=f"client_rule:{flag.rule}:{first}",
                    category=flag.category,
                    severity=flag.severity,
                    title=words.title,
                    detail=words.detail,
                    quote=None,
                    section_id=None,
                    element_ids=list(flag.element_ids),
                    amount_inr=flag.amount_inr,
                    origin="client_rule",
                ),
                nudge_phrase=words.nudge_phrase,
                rule=flag.rule,
            )
        )
    return risks


MAX_PHRASE_WORDS = 14
_ACRONYM_RE = re.compile(r"\b(emi|emis|sms|nach|upi|gst|otp|pan|kyc|ifsc|apr)\b", re.IGNORECASE)


def _sentence_start(text: str) -> str:
    """Ready to follow "Before you agree:": acronyms in capitals, ordinary first word lower."""
    text = _ACRONYM_RE.sub(lambda m: m.group(1).upper().replace("EMIS", "EMIs"), text.strip())
    return templates.lower_first(text)


def nudge_phrase(phrase: str, title: str) -> str:
    """The model's phrase, or the risk title when the phrase is too long to speak whole."""
    cleaned = phrase.strip().rstrip(".")
    if not cleaned or len(cleaned.split()) > MAX_PHRASE_WORDS:
        cleaned = title.strip().rstrip(".")
    return _sentence_start(cleaned)


def findings_to_risks(page: Page, findings: list[Finding]) -> list[ScanRisk]:
    """Keep findings whose quotes are really on the page; at most 12, most severe first."""
    risks: list[ScanRisk] = []
    keys: set[str] = set()
    ordered = sorted(findings, key=lambda f: SEVERITY_ORDER[f.severity])
    for finding in ordered:
        located = find_quote(page.section_by_id, finding.section_id, finding.quote)
        if located is None:
            continue
        section_id, quote = located
        key = f"page_text:{finding.category}:{section_id}"
        if key in keys:
            continue
        keys.add(key)
        risks.append(
            ScanRisk(
                flag=RiskFlag(
                    id="",
                    key=key,
                    category=finding.category,
                    severity=finding.severity,
                    title=templates.clip(finding.title, 60),
                    detail=templates.clip(finding.detail, 200),
                    quote=quote[:MAX_QUOTE_CHARS],
                    section_id=section_id,
                    element_ids=[],
                    amount_inr=first_rupee_amount(quote),
                    origin="page_text",
                ),
                nudge_phrase=nudge_phrase(finding.nudge_phrase, finding.title) or None,
            )
        )
        if len(risks) == MAX_TEXT_RISKS:
            break
    return risks


def merge_risks(client: list[ScanRisk], text: list[ScanRisk]) -> list[ScanRisk]:
    """Client-rule risks first, then text risks that don't repeat them; sorted; IDs r-1, r-2…"""
    kept = list(client)
    for risk in text:
        if not any(_duplicates(risk.flag, existing.flag) for existing in client):
            kept.append(risk)
    kept.sort(key=lambda risk: SEVERITY_ORDER[risk.flag.severity])
    return [
        ScanRisk(
            flag=risk.flag.model_copy(update={"id": f"r-{number}"}),
            nudge_phrase=risk.nudge_phrase,
            rule=risk.rule,
        )
        for number, risk in enumerate(kept, start=1)
    ]


def _duplicates(text_risk: RiskFlag, client_risk: RiskFlag) -> bool:
    if text_risk.category != client_risk.category:
        return False
    if set(risk_targets([text_risk])) & set(risk_targets([client_risk])):
        return True
    return text_risk.amount_inr is not None and text_risk.amount_inr == client_risk.amount_inr


def risk_targets(risks: list[RiskFlag]) -> list[str]:
    """Element and section IDs to highlight, in order, without repeats."""
    targets: list[str] = []
    for risk in risks:
        for target in [*risk.element_ids, risk.section_id]:
            if target and target not in targets:
                targets.append(target)
    return targets


def counts(risks: list[ScanRisk]) -> ScanCounts:
    severities = [risk.flag.severity for risk in risks]
    return ScanCounts(
        high=severities.count("high"),
        medium=severities.count("medium"),
        info=severities.count("info"),
    )


def split_parts(sections: list[PreparedSection]) -> list[list[PreparedSection]]:
    """Up to 60,000 characters of the page in parts of at most 20,000, split between sections."""
    parts: list[list[PreparedSection]] = [[]]
    size = total = 0
    for section in sections:
        length = len(section.labelled())
        if total + length > MAX_SCAN_CHARS:
            break
        if parts[-1] and size + length > PART_CHARS:
            parts.append([])
            size = 0
        parts[-1].append(section)
        size += length
        total += length
    return [part for part in parts if part]


# --- Nudges ---


def _nudge_order(indexed: tuple[int, ScanRisk]) -> tuple[int, int, int]:
    index, risk = indexed
    return (
        SEVERITY_ORDER[risk.flag.severity],
        CATEGORY_ORDER.index(risk.flag.category),
        index,
    )


def flat_rate_line(page: Page, risk: ScanRisk) -> str:
    rate_text = templates.flat_rate_text(page, risk.flag)
    loan = loan_text.from_page(page).loan_input()
    if loan is None:
        return templates.flat_rate_nudge(rate_text, None)
    try:
        result = calc.calculate(loan)
    except IrisError:
        return templates.flat_rate_nudge(rate_text, None)
    return templates.flat_rate_nudge(rate_text, result.apr_percent)


def build_nudge(
    page: Page, risks: list[ScanRisk], exclude_keys: set[str], speakable_say: bool = False
) -> Nudge | None:
    candidates = [
        (index, risk)
        for index, risk in enumerate(risks)
        if risk.flag.key not in exclude_keys
        and risk.flag.severity in ("high", "medium")
        and risk.nudge_phrase
    ]
    if not candidates:
        return None
    ordered = [risk for _, risk in sorted(candidates, key=_nudge_order)]
    top = ordered[0]
    if top.rule == "flat_rate_offer":
        used = [top]
        say = flat_rate_line(page, top)
    else:
        verb = NUDGE_VERBS.get(page.page_type, "continue")
        used = ordered[:2]
        say = ""
        while used:
            show_where = len(used) == 1 and len(risk_targets([used[0].flag])) == 1
            phrases = [risk.nudge_phrase or "" for risk in used]
            say = templates.nudge_line(verb, phrases, show_where)
            if len(say.split()) < MAX_NUDGE_WORDS or len(used) == 1:
                break
            used = used[:1]
    flags = [risk.flag for risk in used]
    return Nudge(
        say=finalise(say, speakable_say=speakable_say),
        risk_ids=[flag.id for flag in flags],
        risk_keys=[flag.key for flag in flags],
        highlight_ids=risk_targets(flags),
    )


# --- The service ---


class ScanService:
    def __init__(
        self, llm: LLMClient, settings: Settings, clock: Callable[[], float] = time.monotonic
    ) -> None:
        self.llm = llm
        self.settings = settings
        self.clock = clock
        # Text risks by (content hash, kind): reloading a page costs nothing for 24 hours.
        self._cache: TTLCache[tuple[str, ScanKind], list[ScanRisk]] = TTLCache(
            SCAN_CACHE_SECONDS, SCAN_CACHE_SIZE, clock
        )
        self._tasks: set[asyncio.Task[None]] = set()

    def start(self, page: Page) -> ScanState:
        kind = SCANNED_TYPES.get(page.page_type)
        client = client_flag_risks(page)
        if kind is None:
            if client:
                state = ScanState(status="ready", kind="general", risks=merge_risks(client, []))
            else:
                state = ScanState(status="none", kind=None)
            state.done.set()
        else:
            cached = self._cache.get((page.content_hash, kind))
            if cached is not None:
                state = ScanState(status="ready", kind=kind, risks=merge_risks(client, cached))
                state.done.set()
            else:
                state = ScanState(status="pending", kind=kind)
                self._spawn(self._complete(page, state, client))
        page.scan = state
        return state

    async def run_now(self, page: Page, kind: ScanKind) -> ScanState:
        """A scan on request, for pages that weren't scanned on registration."""
        state = ScanState(status="pending", kind=kind)
        page.scan = state
        await self._complete(page, state, client_flag_risks(page))
        return state

    async def wait(self, state: ScanState, seconds: float) -> None:
        try:
            await asyncio.wait_for(state.done.wait(), seconds)
        except TimeoutError:
            return

    def result(self, page: Page, exclude_keys: set[str]) -> ScanResult:
        state = page.scan
        ready = state is not None and state.status == "ready"
        risks = state.risks if state is not None and ready else []
        return ScanResult(
            page_id=page.page_id,
            status=state.status if state else "none",
            kind=state.kind if state else None,
            risks=[risk.flag for risk in risks],
            counts=counts(risks),
            nudge=build_nudge(page, risks, exclude_keys, self.settings.iris_speakable_say)
            if ready
            else None,
        )

    async def close(self) -> None:
        for task in list(self._tasks):
            task.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)

    def _spawn(self, job: Coroutine[Any, Any, None]) -> None:
        task = asyncio.create_task(job)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def _complete(self, page: Page, state: ScanState, client: list[ScanRisk]) -> None:
        kind = state.kind or "general"
        try:
            text = await self.text_risks(page, kind)
            self._cache.set((page.content_hash, kind), text)
        except Exception:
            # The client-rule risks still stand on their own.
            logger.warning("page text scan failed", extra={"iris": {"scan_kind": kind}})
            text = []
        try:
            state.risks = merge_risks(client, text)
            state.status = "ready"
        except Exception:
            logger.exception("scan merge failed")
            state.status = "failed"
        finally:
            state.done.set()

    async def text_risks(self, page: Page, kind: ScanKind) -> list[ScanRisk]:
        sections = [section for section in page.sections if section.text]
        if not sections:
            return []
        if kind in ("terms", "privacy"):
            prompt = f"scan_{kind}"
            model, timeout = self.settings.llm_model_deep, SCAN_DEEP_TIMEOUT
        else:
            prompt = "scan_checkout"
            model, timeout = self.settings.llm_model_fast, FAST_TIMEOUT
        tasks = [
            LlmTask(
                name="scan_findings",
                output=ScanFindings,
                model=model,
                purpose=f"scan_{kind}",
                messages=build_messages(
                    prompt,
                    page.header() + "\n\nSECTIONS:\n" + "\n\n".join(s.labelled() for s in part),
                ),
                max_tokens=4000,  # 12 findings reached ~2,900 tokens on the demo terms
                timeout=timeout,
                fake_input=SectionsFake(part),
            )
            for part in split_parts(sections)
        ]
        results = await asyncio.gather(*(self.llm.complete(task) for task in tasks))
        findings = [item for result in results for item in result.items]
        return findings_to_risks(page, findings)
