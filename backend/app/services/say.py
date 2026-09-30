"""Spoken-line rules. Card text never goes through here."""

import re

MAX_WORDS = 45
MAX_STATEMENTS = 2
MAX_OFFER_WORDS = 10

_MD_LINK_RE = re.compile(r"\[([^\]]+)\]\([^)]*\)")
# A URL never ends in the sentence's own punctuation.
_URL_RE = re.compile(r"(?:https?://|www\.)\S*[^\s.,;:!?)\]]", re.IGNORECASE)
_ID_RE = re.compile(r"\s*[\[(]?\b[isr]-\d+\b[\])]?")
_CLAUSE_REF_RE = re.compile(r"\b(section|clause)\s+\d+(?:\.\d+)*\b", re.IGNORECASE)
# "7.2", but not "1.5%", "2.5 lakh", "1.5 times" or the paise in "₹5,899.90".
_SECTION_NUMBER_RE = re.compile(
    r"(?<![\d,₹.])\b\d+\.\d+(?:\.\d+)*\b"
    r"(?!\s*(?:%|percent|per\s*cent|lakh|crore|times|x\b|months?|years?|days?|hours?|minutes?))",
    re.IGNORECASE,
)
_MD_MARKS_RE = re.compile(r"(\*\*|__|`|~~|^#+\s*|^\s*[-*•]\s+)", re.MULTILINE)
_EMPHASIS_RE = re.compile(r"(?<!\w)[*_](\S[^*_]*?)[*_](?!\w)")
_SENTENCE_RE = re.compile(r"(?<=[.!?])\s+(?=[\"'‘“(₹A-Z0-9])")

ACRONYMS = ("NACH", "IFSC", "GST", "UPI", "EMI", "APR")


def strip_unspeakable(text: str) -> str:
    text = _MD_LINK_RE.sub(r"\1", text)
    text = _URL_RE.sub("", text)
    text = _MD_MARKS_RE.sub("", text)
    text = _EMPHASIS_RE.sub(r"\1", text)
    text = _CLAUSE_REF_RE.sub(lambda m: f"the {m.group(1).lower()}", text)
    text = _ID_RE.sub("", text)
    text = _SECTION_NUMBER_RE.sub("", text)
    text = re.sub(r"\(\s*\)", "", text)
    text = re.sub(r"\s+", " ", text)
    text = re.sub(r"\s+([,.;:!?])", r"\1", text)
    text = re.sub(r"([,;:])(?=[.!?])", "", text)
    return text.strip()


def _words(text: str) -> int:
    return len(text.split())


def _cut_words(sentence: str, limit: int) -> str:
    words = sentence.split()
    if len(words) <= limit:
        return sentence
    cut = " ".join(words[:limit])
    comma = cut.rfind(",")
    if comma > len(cut) // 2:
        cut = cut[:comma]
    return cut.rstrip(",;: ") + "."


def limit_length(text: str) -> str:
    """At most two statements and about 45 words; a short closing offer ("Want …?") is kept."""
    sentences = [s.strip() for s in _SENTENCE_RE.split(text) if s.strip()]
    if not sentences:
        return ""
    offer = None
    closing = sentences[-1]
    if len(sentences) > 1 and closing.endswith("?") and _words(closing) <= MAX_OFFER_WORDS:
        offer = sentences.pop()
    statements = sentences[:MAX_STATEMENTS]
    budget = MAX_WORDS - (_words(offer) if offer else 0)
    while len(statements) > 1 and sum(_words(s) for s in statements) > budget:
        statements.pop()
    statements[0] = _cut_words(statements[0], budget)
    return " ".join([*statements, offer] if offer else statements)


def _lakh_words(amount: int) -> str:
    if amount >= 1_00_00_000:
        value, unit = amount / 1_00_00_000, "crore"
    else:
        value, unit = amount / 1_00_000, "lakh"
    if value == 1:
        return f"one {unit} rupees"
    text = f"{value:.2f}".rstrip("0").rstrip(".")
    return f"{text} {unit} rupees"


def _speak_amount(match: re.Match[str]) -> str:
    digits = match.group(1)
    whole_text, _, paise = digits.partition(".")
    whole = int(whole_text.replace(",", ""))
    if whole >= 1_00_000 and not paise:
        return _lakh_words(whole)
    return f"{digits} rupees"


def speakable(text: str) -> str:
    """Amounts and acronyms as the voice should say them: '₹1,00,000' → 'one lakh rupees'."""
    text = re.sub(r"₹\s?(\d[\d,]*(?:\.\d+)?)", _speak_amount, text)
    for acronym in ACRONYMS:
        text = re.sub(rf"\b{acronym}\b", "-".join(acronym), text)
    return text


def finalise(text: str, *, speakable_say: bool = False) -> str:
    line = limit_length(strip_unspeakable(text))
    if line and line[0].islower():
        line = line[0].upper() + line[1:]
    return speakable(line) if speakable_say else line
