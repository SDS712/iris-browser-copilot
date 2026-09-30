"""Deterministic words: client-rule risk titles, nudges and templated say lines.

Every figure comes from the snapshot or from code.
"""

from dataclasses import dataclass
from typing import TYPE_CHECKING

from app.schemas.common import RiskFlag
from app.schemas.snapshot import ClientFlag
from app.services.money import format_inr

if TYPE_CHECKING:
    from app.services.pages import Page

PERIOD_WORDS = {"month": "a month", "year": "a year", "once": "one-off"}


def _amount(flag: ClientFlag, *keys: str) -> float | None:
    for key in keys:
        value = flag.params.get(key)
        if isinstance(value, int | float):
            return float(value)
    return float(flag.amount_inr) if flag.amount_inr is not None else None


def _param_str(flag: ClientFlag, key: str, default: str) -> str:
    value = flag.params.get(key)
    return str(value) if value is not None else default


def _rate_text(flag: ClientFlag) -> str:
    rate = flag.params.get("rate_percent")
    basis = flag.params.get("rate_basis", "flat_monthly")
    rate_str = f"{rate:g}" if isinstance(rate, int | float) else str(rate or "")
    unit = "a year" if basis == "flat_annual" else "a month"
    return f"{rate_str}% {unit} flat" if rate_str else "a flat rate"


def clip(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


@dataclass(frozen=True)
class RiskWords:
    title: str
    detail: str
    nudge_phrase: str | None


def client_flag_words(flag: ClientFlag, label: str | None) -> RiskWords:
    """Title (≤ 60 chars), detail (≤ 200 chars) and nudge phrase for one client flag."""
    quoted = f"'{clip(label, 90)}'" if label else "This option"
    amount = _amount(flag)
    money = format_inr(amount) if amount is not None else None

    phrase: str | None
    match flag.rule:
        case "prechecked_paid_addon":
            title = f"{money} add-on already ticked" if money else "Paid add-on already ticked"
            detail = f"{quoted} was ticked before you touched it."
            phrase = (
                f"a {money} add-on is already ticked"
                if money
                else "a paid add-on is already ticked"
            )
        case "late_price":
            title = (
                f"{money} fee added at the last step"
                if money
                else "New charge added at the last step"
            )
            detail = f"{quoted} wasn't there when the page first loaded."
            fee_name = (label or "fee").lower()
            phrase = (
                f"a {money} {fee_name} was just added"
                if money
                else f"a new {fee_name} was just added"
            )
        case "trial_to_paid":
            then = _amount(flag, "then_inr")
            then_money = format_inr(then) if then is not None else None
            period = PERIOD_WORDS.get(_param_str(flag, "then_period", "month"), "a month")
            days = _param_str(flag, "trial_days", "")
            title = (
                f"Free trial turns into {then_money} {period}"
                if then_money
                else "Free trial turns into a paid plan"
            )
            after = f" after {days} days" if days else ""
            detail = f"{quoted} becomes paid{after} unless you cancel."
            phrase = (
                f"the free trial becomes {then_money} {period}{after}"
                if then_money
                else f"the free trial becomes paid{after}"
            )
        case "flat_rate_offer":
            rate = _rate_text(flag)
            title = f"'{rate}' costs more than it sounds"
            detail = (
                "Flat interest is charged on the full amount for the whole loan, "
                "even as you pay it back, so the real yearly rate is much higher."
            )
            phrase = f"'{rate}' costs more than it sounds"
        case "prechecked_marketing_consent":
            title = "Marketing messages already ticked"
            detail = f"{quoted} was ticked before you touched it."
            phrase = "marketing messages are already ticked"
        case "countdown_timer":
            title = "Countdown timer on the offer"
            detail = "A timer is counting down on this page, which can rush your decision."
            phrase = None
        case "hidden_cookie_reject":
            title = "Cookie banner hides the reject option"
            detail = (
                "The cookie banner offers to accept all, but has no visible reject button. "
                "The reject option may be under the manage settings."
            )
            phrase = None
    return RiskWords(title=clip(title, 60), detail=clip(detail, 200), nudge_phrase=phrase)


# --- Nudges ---


def nudge_line(verb: str, phrases: list[str], show_where: bool) -> str:
    joined = phrases[0] if len(phrases) == 1 else f"{phrases[0]}, and {phrases[1]}"
    # The nudge highlights its one element itself, so there's nothing to offer to show.
    offer = "I've highlighted it." if show_where else "Want the details?"
    return f"Before you {verb}: {joined}. {offer}"


def flat_rate_text(page: "Page", risk: RiskFlag) -> str:
    """'1.5% a month flat', from the flag that raised the risk."""
    for flag in page.snapshot.client_flags:
        if flag.rule == "flat_rate_offer" and flag.element_ids == risk.element_ids:
            return _rate_text(flag)
    return "a flat rate"


def flat_rate_nudge(rate_text: str, apr_percent: float | None) -> str:
    if apr_percent is None:
        return (
            f"Heads up: '{rate_text}' costs more than it sounds. Want me to work out the real rate?"
        )
    return f"Heads up: {rate_text} is closer to {apr_percent:.1f}% a year. Want the breakdown?"


# --- Scan tool ---


def lower_first(text: str) -> str:
    """Lower-case a leading ordinary word for mid-sentence use; names and acronyms stay
    ("The fee" → "the fee", but "QuickCred", "EMI" and "₹1,299" are unchanged)."""
    first = text.split(" ", 1)[0]
    if not first[:1].isupper() or not first[1:].islower():
        return text
    return text[:1].lower() + text[1:]


def scan_say(risks: list[RiskFlag]) -> str:
    if not risks:
        return "I didn't find anything worrying on this page. Want a quick summary instead?"
    things = "thing" if len(risks) == 1 else "things"
    return (
        f"I found {len(risks)} {things} worth a look. "
        f"The biggest: {lower_first(risks[0].title)}. Want me to go through them?"
    )


def scan_lead(risks: list[RiskFlag]) -> str:
    if not risks:
        return "Nothing worrying found on this page."
    high = sum(1 for risk in risks if risk.severity == "high")
    medium = sum(1 for risk in risks if risk.severity == "medium")
    parts = [f"{high} high" if high else "", f"{medium} medium" if medium else ""]
    detail = ", ".join(part for part in parts if part)
    things = "thing" if len(risks) == 1 else "things"
    summary = f"{len(risks)} {things} worth a look"
    return f"{summary} ({detail})." if detail else f"{summary}."


# --- Site trust ---

VERDICT_LABELS = {
    "looks_ok": "Looks OK",
    "be_careful": "Be careful",
    "likely_unsafe": "Likely unsafe",
}
CHECKS_LINE = "Checks: domain age, look-alike names, public reports."
LOCAL_ADDRESS = "This is a local or private address, so I can't check it."
BARE_IP = "The address is a bare IP number, not a name"
BARE_IP_SAY = (
    "This site's address is a bare IP number instead of a name, which real banks and shops "
    "don't use. That's a reason to be careful. Want the details?"
)


def age_text(days: int) -> str:
    if days < 60:
        return f"{days} day" if days == 1 else f"{days} days"
    if days < 730:
        return f"{days // 30} months"
    return f"{days // 365} years"


def reports_sentence(reports: int, checked: bool) -> str:
    if not checked:
        return "I couldn't check for public reports right now."
    if reports == 0:
        return "I didn't find any scam reports."
    if reports == 1:
        return "I found one public report of fraud."
    return f"I found {reports} public reports of fraud."


def trust_say(
    verdict: str,
    *,
    domain: str,
    age_days: int | None,
    official: bool,
    similar_to: str | None,
    reports: int,
    reports_checked: bool,
) -> str:
    details = "Want the details?"
    young = age_days is not None and age_days < 180
    if verdict == "looks_ok":
        if official and reports_checked:
            return (
                f"This looks like the official {domain} site, and I didn't find any scam "
                f"reports. {details}"
            )
        if official:
            return (
                f"This looks like the official {domain} site. "
                f"{reports_sentence(reports, reports_checked)} {details}"
            )
        age = f"{age_text(age_days)} old" if age_days is not None else "not new"
        if reports_checked:
            return (
                f"This site's domain is {age} and I didn't find any scam reports, so it looks "
                f"OK. {details}"
            )
        return f"This site's domain is {age} and nothing else stood out. {details}"
    if verdict == "likely_unsafe":
        if similar_to:
            return (
                f"This address looks a lot like {similar_to}, but it isn't the official site, "
                f"so it's likely unsafe. {details}"
            )
        if reports >= 2:
            return (
                f"I found {reports} public reports of fraud about this site, so it's likely "
                f"unsafe. {details}"
            )
        return (
            f"This site's domain is only {age_text(age_days or 0)} old and there's a public report "
            f"of fraud about it, so it's likely unsafe. {details}"
        )
    if young:
        return (
            f"This site's domain is only {age_text(age_days or 0)} old, which is a reason to be "
            f"careful. {reports_sentence(reports, reports_checked)} {details}"
        )
    if reports == 1:
        return (
            "I found one public report of fraud about this site, so it's worth being careful. "
            f"{details}"
        )
    return (
        "I couldn't find out how old this site's domain is, which is a reason to be careful. "
        f"{reports_sentence(reports, reports_checked)} {details}"
    )


# --- Loan cost ---

GST_NOT_STATED = "Plus GST on the fee, which the page doesn't state."


def advertised_rate(rate_percent: float, basis: str) -> str:
    if basis == "flat_monthly":
        return f"{rate_percent:g}% a month flat"
    if basis == "flat_annual":
        return f"{rate_percent:g}% a year flat"
    return f"{rate_percent:g}% a year"


def loan_say(advertised: str, basis: str, apr_percent: float) -> str:
    if basis.startswith("flat"):
        return (
            f"'{advertised}' works out to about {apr_percent:.1f}% a year, because interest is "
            "charged on the full amount even as you pay it back. The card shows the maths."
        )
    return (
        f"With the fees counted, '{advertised}' works out to about {apr_percent:.1f}% a year. "
        "The card shows the maths."
    )
