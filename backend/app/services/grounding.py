"""Quote verification: a quote is only kept if it's really on the page."""

from collections.abc import Mapping

from rapidfuzz import fuzz

from app.services.pages import PreparedSection

FUZZY_THRESHOLD = 95
MIN_FUZZY_CHARS = 20
MAX_QUOTE_CHARS = 220

_CHAR_MAP = {
    "‘": "'",
    "’": "'",
    "‚": "'",
    "‛": "'",
    "“": '"',
    "”": '"',
    "„": '"',
    "‐": "-",
    "‑": "-",
    "‒": "-",
    "–": "-",
    "—": "-",
    "−": "-",
}
_TRIM_CHARS = " \"'…"


def _normalise(text: str) -> tuple[str, list[int]]:
    """Collapsed, case-folded text plus, for each character, its index in the original."""
    chars: list[str] = []
    index: list[int] = []
    last_was_space = True
    for position, raw in enumerate(text):
        char = _CHAR_MAP.get(raw, raw)
        if char.isspace():
            if last_was_space:
                continue
            chars.append(" ")
            last_was_space = True
        else:
            lowered = char.lower()
            chars.append(lowered[0] if lowered else char)
            last_was_space = False
        index.append(position)
    if chars and chars[-1] == " ":
        chars.pop()
        index.pop()
    return "".join(chars), index


def _clip(span: str) -> str:
    if len(span) <= MAX_QUOTE_CHARS:
        return span
    cut = span[:MAX_QUOTE_CHARS]
    space = cut.rfind(" ")
    return cut[:space] if space > MAX_QUOTE_CHARS // 2 else cut


def verify_quote(section_text: str, quote: str) -> str | None:
    """The exact page span the quote refers to, or None if it isn't on the page."""
    norm_page, index = _normalise(section_text)
    norm_quote = _normalise(quote)[0].strip(_TRIM_CHARS)
    if not norm_quote or not norm_page:
        return None
    # Try with the closing full stop first, so a whole sentence keeps it.
    for candidate in dict.fromkeys([norm_quote, norm_quote.rstrip(". ")]):
        position = norm_page.find(candidate) if candidate else -1
        if position >= 0:
            start = index[position]
            end = index[position + len(candidate) - 1] + 1
            return _clip(section_text[start:end])
    norm_quote = norm_quote.rstrip(". ")
    if len(norm_quote) < MIN_FUZZY_CHARS or len(norm_quote) > len(norm_page):
        return None
    alignment = fuzz.partial_ratio_alignment(norm_quote, norm_page)
    if alignment is None or alignment.score < FUZZY_THRESHOLD:
        return None
    start = index[alignment.dest_start]
    end = index[alignment.dest_end - 1] + 1
    return _clip(section_text[start:end].strip())


def find_quote(
    sections: Mapping[str, PreparedSection], section_id: str | None, quote: str | None
) -> tuple[str, str] | None:
    """(section_id, verified text): the named section first, then the rest of the page."""
    if not quote:
        return None
    ordered = list(sections.values())
    if section_id is not None and section_id in sections:
        ordered.remove(sections[section_id])
        ordered.insert(0, sections[section_id])
    for section in ordered:
        verified = verify_quote(section.text, quote)
        if verified:
            return section.id, verified
    return None
