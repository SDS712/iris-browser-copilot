"""site_trust: domain age, look-alike names and public reports. The verdict is code."""

import ipaddress
from dataclasses import dataclass
from datetime import UTC, datetime
from functools import cache
from typing import Literal
from urllib.parse import urlsplit

import tldextract

from app.errors import ErrorCode, IrisError
from app.schemas.api import SiteTrustRequest, ToolResult
from app.schemas.cards import TrustCard, TrustReason
from app.schemas.common import Source
from app.services import lookalike, templates
from app.services.container import Services
from app.services.llm import FAST_TIMEOUT, LlmTask, build_messages
from app.services.llm_tasks import ScamReports
from app.services.search import SearchHit
from app.services.tools.common import tool_result

Verdict = Literal["looks_ok", "be_careful", "likely_unsafe"]
_LOCAL_SUFFIXES = (".localhost", ".local", ".internal", ".lan", ".home.arpa")
_SOFT_FAILURES = (ErrorCode.UPSTREAM_ERROR, ErrorCode.UPSTREAM_TIMEOUT)


@cache
def _extractor() -> tldextract.TLDExtract:
    # The bundled public-suffix list only: no network fetch, no cache on disk.
    return tldextract.TLDExtract(suffix_list_urls=(), cache_dir=None)


@dataclass(frozen=True)
class TrustFacts:
    domain: str
    age_days: int | None
    official: bool
    similar_to: str | None
    reports: int
    reports_checked: bool
    report_sources: tuple[Source, ...] = ()


def verdict(facts: TrustFacts) -> Verdict:
    """The verdict rules, checked top down; the first match wins."""
    age = facts.age_days
    if facts.official and facts.reports == 0:
        return "looks_ok"
    if (
        facts.similar_to
        or facts.reports >= 2
        or (age is not None and age < 30 and facts.reports >= 1)
    ):
        return "likely_unsafe"
    if (
        (age is not None and age < 180)
        or facts.reports == 1
        or (age is None and not facts.official)
    ):
        return "be_careful"
    return "looks_ok"


def reasons(facts: TrustFacts) -> list[TrustReason]:
    found: list[TrustReason] = []
    if facts.official:
        found.append(TrustReason(text=f"Matches the official {facts.domain} domain", level="good"))
    if facts.similar_to:
        found.append(TrustReason(text=f"Looks a lot like {facts.similar_to}", level="bad"))
    if facts.age_days is None:
        found.append(TrustReason(text="Couldn't find when the domain was registered", level="warn"))
    elif facts.age_days < 180:
        level: Literal["bad", "warn"] = "bad" if facts.age_days < 30 else "warn"
        age = templates.age_text(facts.age_days)
        found.append(TrustReason(text=f"Domain registered {age} ago", level=level))
    else:
        age = templates.age_text(facts.age_days)
        found.append(TrustReason(text=f"Registered {age} ago", level="good"))
    if not facts.reports_checked:
        found.append(TrustReason(text="Couldn't check public reports right now", level="warn"))
    elif facts.reports == 0:
        found.append(TrustReason(text="No scam reports found", level="good"))
    elif facts.reports == 1:
        found.append(TrustReason(text="1 public report of fraud", level="warn"))
    else:
        found.append(TrustReason(text=f"{facts.reports} public reports of fraud", level="bad"))
    return found


def host_of(url: str) -> str:
    candidate = url.strip()
    if "://" not in candidate:
        candidate = f"https://{candidate}"
    host = urlsplit(candidate).hostname
    if not host:
        raise IrisError(
            ErrorCode.INVALID_REQUEST,
            "That doesn't look like a web address.",
            agent_message="I couldn't read the site's address. Tell the user you can't check it.",
        )
    return host.lower().rstrip(".")


def registrable(host: str) -> tuple[str, str]:
    """The registrable domain and its main label: 'login.hdfcbank-secure.in' →
    ('hdfcbank-secure.in', 'hdfcbank-secure')."""
    parts = _extractor()(host)
    domain = parts.top_domain_under_public_suffix or host
    return domain, parts.domain or domain


def ip_of(host: str) -> ipaddress.IPv4Address | ipaddress.IPv6Address | None:
    try:
        return ipaddress.ip_address(host.strip("[]"))
    except ValueError:
        return None


def is_local(host: str) -> bool:
    """This computer or a private network: nothing to check. A public IP isn't local."""
    if host == "localhost" or host.endswith(_LOCAL_SUFFIXES):
        return True
    ip = ip_of(host)
    if ip is None:
        return "." not in host
    return ip.is_private or ip.is_loopback or ip.is_link_local


def public_ip_result(services: Services, host: str) -> ToolResult:
    """A site reached by a bare public IP: worth checking, and there's no domain to look up."""
    card = TrustCard(
        topic="Site check",
        source="calculated",
        lead=f"{templates.VERDICT_LABELS['be_careful']}. {templates.BARE_IP}.",
        verdict="be_careful",
        domain=host,
        reasons=[TrustReason(text=templates.BARE_IP, level="bad")],
        checks_line=templates.CHECKS_LINE,
    )
    return tool_result(services.settings, say=templates.BARE_IP_SAY, card=card)


def local_result(services: Services, host: str) -> ToolResult:
    card = TrustCard(
        topic="Site check",
        source="calculated",
        lead=templates.LOCAL_ADDRESS,
        verdict="be_careful",
        domain=host,
        reasons=[TrustReason(text=templates.LOCAL_ADDRESS, level="warn")],
        checks_line=templates.CHECKS_LINE,
    )
    return tool_result(services.settings, say=templates.LOCAL_ADDRESS, card=card)


async def domain_age_days(services: Services, domain: str) -> int | None:
    registered = await services.rdap.registration_date(domain)
    if registered is None:
        return None
    if registered.tzinfo is None:
        registered = registered.replace(tzinfo=UTC)
    return max(0, (datetime.now(UTC) - registered).days)


async def public_reports(services: Services, domain: str) -> tuple[int, bool, list[SearchHit]]:
    """(fraud reports about this exact domain, whether the check ran, the reporting results)."""
    try:
        hits = await services.search.search(f'"{domain}" scam OR fraud OR complaint')
    except IrisError as exc:
        if exc.code in _SOFT_FAILURES:
            return 0, False, []
        raise
    if not hits:
        return 0, True, []
    numbered = "\n\n".join(
        f"[{index}] {hit.title}\nURL: {hit.url}\n{hit.content[:600]}"
        for index, hit in enumerate(hits)
    )
    task = LlmTask(
        name="scam_reports",
        output=ScamReports,
        model=services.settings.llm_model_fast,
        purpose="scam_classify",
        messages=build_messages("scam_classify", f"DOMAIN: {domain}\n\nRESULTS:\n{numbered}"),
        max_tokens=200,
        timeout=FAST_TIMEOUT,
    )
    try:
        result = await services.llm.complete(task)
    except IrisError as exc:
        if exc.code in _SOFT_FAILURES:
            return 0, False, []
        raise
    indexes = sorted({i for i in result.fraud_report_indexes if 0 <= i < len(hits)})
    return len(indexes), True, [hits[i] for i in indexes]


async def gather_facts(services: Services, domain: str, label: str) -> TrustFacts:
    cached = services.caches.trust.get(domain)
    if isinstance(cached, TrustFacts):
        return cached
    match = lookalike.check(domain, label)
    age = await domain_age_days(services, domain)
    reports, checked, hits = await public_reports(services, domain)
    facts = TrustFacts(
        domain=domain,
        age_days=age,
        official=match.official,
        similar_to=match.similar_to,
        reports=reports,
        reports_checked=checked,
        report_sources=tuple(hit.source() for hit in hits[:3]),
    )
    services.caches.trust.set(domain, facts)
    return facts


async def site_trust(services: Services, request: SiteTrustRequest) -> ToolResult:
    host = host_of(request.url)
    if is_local(host):
        return local_result(services, host)
    if ip_of(host) is not None:
        return public_ip_result(services, host)
    domain, label = registrable(host)
    facts = await gather_facts(services, domain, label)
    outcome = verdict(facts)
    found = reasons(facts)
    concerns = [reason.text for reason in found if reason.level != "good"]
    lead = f"{templates.VERDICT_LABELS[outcome]}. " + (
        "; ".join(concerns) + "." if concerns else "Everything I checked looks normal."
    )
    card = TrustCard(
        topic="Site check",
        source="web" if facts.reports_checked else "calculated",
        lead=lead,
        verdict=outcome,
        domain=domain,
        reasons=found,
        checks_line=templates.CHECKS_LINE,
    )
    say = templates.trust_say(
        outcome,
        domain=domain,
        age_days=facts.age_days,
        official=facts.official,
        similar_to=facts.similar_to,
        reports=facts.reports,
        reports_checked=facts.reports_checked,
    )
    notes = "; ".join(reason.text for reason in found)
    return tool_result(
        services.settings, say=say, card=card, agent_notes=notes, sources=facts.report_sources
    )
