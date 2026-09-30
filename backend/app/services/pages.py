"""Pages in memory: store, section prep, BM25, page type and summary_for_agent.

Page content lives only here, in memory, for at most 30 minutes after last use.
"""

import hashlib
import json
import re
import secrets
import time
from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import TYPE_CHECKING
from urllib.parse import urlsplit

from rank_bm25 import BM25Okapi

from app.errors import ErrorCode, IrisError
from app.schemas.common import PageType
from app.schemas.snapshot import PageField, PageSnapshot

if TYPE_CHECKING:
    from app.services.scan import ScanState

PAGE_TTL_SECONDS = 30 * 60
MAX_PAGES = 300
CHUNK_CHARS = 1200
CHUNK_OVERLAP = 200
SUMMARY_LIMIT = 1500

_WS_RE = re.compile(r"\s+")
_TOKEN_RE = re.compile(r"[a-z0-9]+")

STOPWORDS = frozenset(
    (
        "a an and are as at be by can could do does for from has have how i if in is it its "
        "me my of on or so that the their them there they this to was what when where which "
        "who will with would you your"
    ).split(" ")
)

# Search synonyms, extended where tests showed gaps.
SYNONYMS: tuple[tuple[tuple[str, ...], str], ...] = (
    (("cancel",), "cancellation terminate termination close withdraw"),
    (
        ("data", "information", "share"),
        "personal data information share disclose third parties partners",
    ),
    (("fee", "charge", "cost"), "fee charge charges penalty gst"),
    (
        ("auto-debit", "auto debit", "autopay", "autodebit", "emis collected", "collected"),
        "mandate nach e-mandate upi autopay auto debit",
    ),
    (
        ("repay early", "prepay", "close loan", "early", "pay off", "foreclos"),
        "foreclosure prepayment pre-closure part-payment",
    ),
    (("late", "miss"), "late payment delay overdue bounce dishonour"),
    (("renew",), "renewal auto-renew renews automatically"),
    (("delete",), "deletion erase remove withdraw consent"),
    (("dispute", "complaint"), "arbitration grievance jurisdiction courts"),
    (("grace",), "grace period"),
    (("refund",), "refund refundable non-refundable"),
)


def normalise_ws(text: str) -> str:
    return _WS_RE.sub(" ", text).strip()


def tokenise(text: str) -> list[str]:
    # One-letter tokens are mostly possessives ("borrower's" → "s") and only add noise.
    return [
        token
        for token in _TOKEN_RE.findall(text.lower())
        if token not in STOPWORDS and (len(token) > 1 or token.isdigit())
    ]


def expand_query(question: str) -> list[str]:
    lowered = question.lower()
    tokens = tokenise(lowered)
    for triggers, expansion in SYNONYMS:
        if any(re.search(r"\b" + re.escape(trigger), lowered) for trigger in triggers):
            tokens.extend(tokenise(expansion))
    return tokens


@dataclass(frozen=True)
class PreparedSection:
    id: str
    heading: str | None
    level: int | None
    text: str
    order: int

    def labelled(self) -> str:
        """The form models see: '[s-7] 7.2 Cancellation\\n<text>'."""
        head = f"[{self.id}] {self.heading}" if self.heading else f"[{self.id}]"
        return f"{head}\n{self.text}"


@dataclass(frozen=True)
class Chunk:
    section_id: str
    order: int
    heading: str | None
    text: str


def prepare_sections(snapshot: PageSnapshot) -> list[PreparedSection]:
    return [
        PreparedSection(
            id=section.id,
            heading=normalise_ws(section.heading) if section.heading else None,
            level=section.level,
            text=normalise_ws(section.text),
            order=order,
        )
        for order, section in enumerate(snapshot.sections)
    ]


def chunk_sections(sections: list[PreparedSection]) -> list[Chunk]:
    chunks = []
    step = CHUNK_CHARS - CHUNK_OVERLAP
    for section in sections:
        if len(section.text) <= CHUNK_CHARS:
            chunks.append(Chunk(section.id, section.order, section.heading, section.text))
            continue
        for start in range(0, len(section.text), step):
            piece = section.text[start : start + CHUNK_CHARS]
            chunks.append(Chunk(section.id, section.order, section.heading, piece))
            if start + CHUNK_CHARS >= len(section.text):
                break
    return chunks


class SectionIndex:
    """BM25 over section chunks; the heading counts twice."""

    def __init__(self, chunks: list[Chunk]) -> None:
        self.chunks = chunks
        corpus = [tokenise(chunk.heading or "") * 2 + tokenise(chunk.text) for chunk in chunks]
        self._bm25 = BM25Okapi(corpus) if any(corpus) else None

    def search(self, question: str, top_k: int = 8) -> list[tuple[Chunk, float]]:
        query = expand_query(question)
        if self._bm25 is None or not query:
            return []
        scores = self._bm25.get_scores(query)
        ranked = sorted(range(len(self.chunks)), key=lambda i: (-scores[i], i))
        return [(self.chunks[i], float(scores[i])) for i in ranked[:top_k] if scores[i] > 0]


def shared_words(question: str, section: PreparedSection) -> int:
    """How many of the question's words a section has. BM25 scores every word zero on a
    page of two or three sections (each word is in "half" the corpus), so small pages need
    this plainer measure."""
    words = set(tokenise(question))
    return len(words & set(tokenise(f"{section.heading or ''} {section.text}")))


# --- Content hash ---


def content_hash(snapshot: PageSnapshot, sections: list[PreparedSection]) -> str:
    """Hash of what the page says (not its URL), for scan caching."""
    material = {
        "sections": [[s.heading, s.text] for s in sections],
        "choices": [normalise_ws(c.label) for c in snapshot.checkboxes],
        "prices": [[p.label, p.amount_text] for p in snapshot.prices],
    }
    return hashlib.sha256(json.dumps(material, ensure_ascii=False).encode()).hexdigest()


# --- Page type (applied to the full snapshot) ---

_CHECKOUT_RE = re.compile(r"\b(checkout|cart|payment|review & pay|order summary)\b")
_TERMS_RE = re.compile(r"\b(terms|conditions|agreement|terms of service)\b")
_PRIVACY_RE = re.compile(r"\b(privacy|data policy)\b")
_OFFER_RE = re.compile(r"\b(emi|per month|p\.m\.|loan|offer)", re.IGNORECASE)
_NUMBERED_HEADING_RE = re.compile(r"^\s*\d+(\.\d+)*[.)]?\s+\S")


def _url_text(url: str) -> str:
    parts = urlsplit(url)
    return f"{parts.netloc} {parts.path}".lower().replace("-", " ").replace("_", " ")


def long_sections(snapshot: PageSnapshot) -> int:
    return sum(1 for section in snapshot.sections if len(section.text) > 400)


def rule_page_type(snapshot: PageSnapshot) -> PageType | None:
    """Page-type rules 1–5. None means 'no specific type' (article or other)."""
    url = _url_text(snapshot.url)
    title = snapshot.title.lower()
    headings = " ".join((s.heading or "").lower() for s in snapshot.sections)
    if (_CHECKOUT_RE.search(url) or _CHECKOUT_RE.search(headings)) and len(snapshot.prices) >= 2:
        return "checkout"
    if _TERMS_RE.search(url) or _TERMS_RE.search(title):
        return "terms"
    if _PRIVACY_RE.search(url) or _PRIVACY_RE.search(title):
        return "privacy"
    # Rule 3b: numbered legal headings, checked after privacy.
    numbered = sum(
        1 for s in snapshot.sections if s.heading and _NUMBERED_HEADING_RE.match(s.heading)
    )
    if numbered >= 5:
        return "terms"
    if len(snapshot.fields) >= 4:
        return "form"
    if snapshot.prices:
        text = " ".join(
            [snapshot.title]
            + [s.text for s in snapshot.sections]
            + [c.label for c in snapshot.checkboxes]
            + [p.label or "" for p in snapshot.prices]
        )
        if _OFFER_RE.search(text):
            return "offer"
    return None


def url_path(url: str) -> str:
    return urlsplit(url).path or "/"


# --- summary_for_agent ---


def _label(text: str | None, limit: int = 80) -> str:
    clean = normalise_ws(text or "").replace('"', "'")
    return clean if len(clean) <= limit else clean[: limit - 1].rstrip() + "…"


def summary_url(url: str) -> str:
    parts = urlsplit(url)
    host = parts.hostname or ""
    if parts.port:
        host = f"{host}:{parts.port}"
    return f"{parts.scheme}://{host}{parts.path}" if parts.scheme else url.split("?")[0]


def _render_list(name: str, items: list[str], hidden: int) -> str:
    shown = "; ".join(items)
    if hidden:
        shown = f"{shown} (+{hidden} more)" if shown else f"(+{hidden} more)"
    return f"{name}: {shown or 'none'}"


def build_summary(snapshot: PageSnapshot, page_type: PageType) -> str:
    title = _label(snapshot.title, 150)
    head = [f"PAGE: {title} (type: {page_type})", f"URL: {summary_url(snapshot.url)}"]

    def field_item(f: PageField) -> str:
        marks = (" [sensitive]" if f.sensitive else "") + (" [required]" if f.required else "")
        return f'{f.id} "{_label(f.label)}"{marks}'

    fields = [field_item(f) for f in snapshot.fields]
    choices = [
        f'{c.id} "{_label(c.label)}"'
        + (" [pre-checked]" if c.prechecked else " [checked]" if c.checked else "")
        for c in snapshot.checkboxes
    ]
    prices = [
        (f'{p.id} "{_label(p.label)}" {p.amount_text}' if p.label else f"{p.id} {p.amount_text}")
        + (" [appeared later]" if p.first_seen_revision > 1 else "")
        for p in snapshot.prices
    ]
    sections = [f'{s.id} "{_label(s.heading)}"' if s.heading else s.id for s in snapshot.sections]
    links = [f'{link.id} "{_label(link.text)}"' for link in snapshot.legal_links]
    banner = snapshot.cookie_banner
    cookie = "none" if banner is None else "yes" if banner.reject_visible else "yes (reject hidden)"
    flags = "; ".join(
        f"{flag.rule} {','.join(flag.element_ids)} ({flag.severity})".replace("  ", " ")
        for flag in snapshot.client_flags
    )

    lists: dict[str, list[str]] = {
        "FIELDS": fields,
        "CHOICES": choices,
        "PRICES": prices,
        "SECTIONS": sections,
        "LEGAL LINKS": links,
    }
    hidden = dict.fromkeys(lists, 0)

    def render() -> str:
        lines = list(head)
        lines += [_render_list(name, lists[name], hidden[name]) for name in lists]
        lines.append(f"COOKIE BANNER: {cookie}")
        lines.append(f"FLAGS: {flags or 'none'}")
        return "\n".join(lines)

    text = render()
    while len(text) > SUMMARY_LIMIT:
        trimmable = [name for name in lists if lists[name]]
        if not trimmable:
            break
        # Trim the longest list first.
        longest = max(trimmable, key=lambda name: len("; ".join(lists[name])))
        lists[longest] = lists[longest][:-1]
        hidden[longest] += 1
        text = render()
    return text[:SUMMARY_LIMIT]


# --- Store ---


def new_page_id() -> str:
    return "pg_" + secrets.token_urlsafe(12)


@dataclass
class Page:
    page_id: str
    snapshot: PageSnapshot
    page_type: PageType
    sections: list[PreparedSection]
    index: SectionIndex
    content_hash: str
    summary_for_agent: str
    last_used: float = 0.0
    scan: "ScanState | None" = None
    section_by_id: dict[str, PreparedSection] = field(default_factory=dict)

    def __post_init__(self) -> None:
        self.section_by_id = {section.id: section for section in self.sections}

    def header(self) -> str:
        """Title, type and URL path: the page context every model prompt starts with."""
        return (
            f"PAGE: {self.snapshot.title}\nTYPE: {self.page_type}\n"
            f"URL PATH: {url_path(self.snapshot.url)}"
        )

    @property
    def total_chars(self) -> int:
        return sum(len(section.text) for section in self.sections)

    def element_label(self, element_id: str) -> str | None:
        snapshot = self.snapshot
        for choice in snapshot.checkboxes:
            if choice.id == element_id:
                return choice.label
        for form_field in snapshot.fields:
            if form_field.id == element_id:
                return form_field.label
        for price in snapshot.prices:
            if price.id == element_id:
                return price.label or price.amount_text
        for button in snapshot.buttons:
            if button.id == element_id:
                return button.text
        return None


class PageStore:
    """In-memory pages: expire 30 minutes after last use; at most 300, least recently used out."""

    def __init__(
        self,
        clock: Callable[[], float] = time.monotonic,
        ttl_seconds: float = PAGE_TTL_SECONDS,
        max_pages: int = MAX_PAGES,
    ) -> None:
        self.clock = clock
        self.ttl_seconds = ttl_seconds
        self.max_pages = max_pages
        self._pages: OrderedDict[str, Page] = OrderedDict()

    def __len__(self) -> int:
        return len(self._pages)

    def add(self, page: Page) -> None:
        page.last_used = self.clock()
        self._pages[page.page_id] = page
        self._pages.move_to_end(page.page_id)
        while len(self._pages) > self.max_pages:
            self._pages.popitem(last=False)

    def get(self, page_id: str) -> Page:
        """Look up a page and touch its expiry; page_not_found if it's gone."""
        page = self._pages.get(page_id)
        now = self.clock()
        if page is None or now - page.last_used > self.ttl_seconds:
            self._pages.pop(page_id, None)
            raise IrisError(ErrorCode.PAGE_NOT_FOUND)
        page.last_used = now
        self._pages.move_to_end(page_id)
        return page

    def find(self, page_id: str) -> Page | None:
        """Like get(), but None for a page that's gone (an earlier page in a journey)."""
        try:
            return self.get(page_id)
        except IrisError:
            return None

    def sweep(self) -> int:
        now = self.clock()
        expired = [
            pid for pid, page in self._pages.items() if now - page.last_used > self.ttl_seconds
        ]
        for page_id in expired:
            del self._pages[page_id]
        return len(expired)
