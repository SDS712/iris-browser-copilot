"""Signs that a site deserves a trust check. Code only: no paid calls.

The client checks the site by itself when a page has a login or payment form, or when one of
these signals is present.
"""

import re
from urllib.parse import urlsplit

from app.schemas.snapshot import PageSnapshot
from app.services import lookalike
from app.services.tools.site_trust import ip_of, is_local, registrable

PAYMENT_LABEL_RE = re.compile(r"card|cvv|cvc|expiry|upi pin|mpin", re.IGNORECASE)
MIN_BRAND_LABEL = 4
_WORD_RE = re.compile(r"[a-z0-9]+")


def has_login_or_payment(snapshot: PageSnapshot) -> bool:
    return any(
        field.type == "password" or (field.sensitive and PAYMENT_LABEL_RE.search(field.label))
        for field in snapshot.fields
    )


def named_brand(snapshot: PageSnapshot, domain: str) -> str | None:
    """A known brand the page names in its title or top headings, other than this site."""
    headings = [s.heading for s in snapshot.sections if s.heading and (s.level or 9) <= 2]
    words = set(_WORD_RE.findall(" ".join([snapshot.title, *headings]).lower()))
    for brand in sorted(lookalike.brand_domains()):
        label = brand.split(".", 1)[0]
        if len(label) >= MIN_BRAND_LABEL and label in words and brand != domain:
            return brand
    return None


def site_signals(snapshot: PageSnapshot) -> list[str]:
    parts = urlsplit(snapshot.url)
    host = (parts.hostname or "").lower()
    if not host or is_local(host):
        return []
    found = []
    if ip_of(host) is not None:
        found.append("ip_host")
    if parts.scheme == "http":
        found.append("no_https")
    if ip_of(host) is None:
        domain, label = registrable(host)
        match = lookalike.check(domain, label)
        if match.similar_to:
            found.append(f"lookalike:{match.similar_to}")
        # A page that names a bank or shop and asks for a password or card, on another domain.
        brand = None if match.official else named_brand(snapshot, domain)
        if brand and has_login_or_payment(snapshot):
            found.append(f"brand_mismatch:{brand}")
    return found
