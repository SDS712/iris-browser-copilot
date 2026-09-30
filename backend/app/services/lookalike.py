"""Look-alike domain checks."""

from dataclasses import dataclass
from functools import cache
from pathlib import Path

from rapidfuzz.distance import Levenshtein

BRANDS_PATH = Path(__file__).resolve().parents[1] / "data" / "brand_domains.txt"
MIN_FUZZY_LABEL = 5
# Very short brand names (sc, jio) would match too many innocent hyphenated names.
MIN_HYPHEN_BRAND = 4
# Characters that look alike on screen, applied in this order.
_SWAPS = (("0", "o"), ("1", "l"), ("rn", "m"), ("vv", "w"), ("l", "i"))


@cache
def brand_domains() -> frozenset[str]:
    lines = BRANDS_PATH.read_text(encoding="utf-8").splitlines()
    return frozenset(
        line.strip().lower() for line in lines if line.strip() and not line.startswith("#")
    )


def _label(domain: str) -> str:
    return domain.split(".", 1)[0]


def _unconfuse(label: str) -> str:
    for old, new in _SWAPS:
        label = label.replace(old, new)
    return label


@dataclass(frozen=True)
class LookalikeResult:
    official: bool
    similar_to: str | None


def check(domain: str, label: str) -> LookalikeResult:
    """`domain` is the registrable domain; `label` its main label (e.g. 'hdfcbank-login')."""
    domain = domain.lower()
    label = label.lower()
    if domain in brand_domains():
        return LookalikeResult(official=True, similar_to=None)
    ending = domain.split(".", 1)[-1]
    # Prefer brands with the same ending: arnazon.in is closest to amazon.in, not amazon.com.
    for brand in sorted(brand_domains(), key=lambda b: (b.split(".", 1)[-1] != ending, b)):
        brand_label = _label(brand)
        if label == brand_label:
            return LookalikeResult(official=False, similar_to=brand)  # same name, other ending
        long_enough = min(len(label), len(brand_label)) >= MIN_FUZZY_LABEL
        if long_enough and 1 <= Levenshtein.distance(label, brand_label) <= 2:
            return LookalikeResult(official=False, similar_to=brand)
        if _unconfuse(label) == _unconfuse(brand_label):
            return LookalikeResult(official=False, similar_to=brand)
        parts = label.split("-")
        if len(parts) > 1 and len(brand_label) >= MIN_HYPHEN_BRAND and brand_label in parts:
            return LookalikeResult(official=False, similar_to=brand)
    return LookalikeResult(official=False, similar_to=None)
