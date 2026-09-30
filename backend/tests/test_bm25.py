"""Section ranking: synonym expansion and chunking."""

from app.services.pages import (
    CHUNK_CHARS,
    PreparedSection,
    SectionIndex,
    chunk_sections,
    expand_query,
    prepare_sections,
)
from tests.helpers import snapshot_model


def terms_index() -> SectionIndex:
    return SectionIndex(chunk_sections(prepare_sections(snapshot_model("terms"))))


def top_section(question: str) -> str:
    results = terms_index().search(question)
    assert results, question
    return results[0][0].section_id


def heading_of(section_id: str) -> str | None:
    sections = {s.id: s.heading for s in prepare_sections(snapshot_model("terms"))}
    return sections[section_id]


def test_synonyms_expand_the_question() -> None:
    tokens = expand_query("Can I cancel anytime?")
    assert "cancel" in tokens
    assert "cancellation" in tokens
    assert "termination" in tokens
    assert "can" not in tokens
    assert "foreclosure" in expand_query("Can I repay early?")
    assert "mandate" in expand_query("Is there an auto-debit?")
    assert "arbitration" in expand_query("How do I raise a dispute?")


def test_cancellation_ranks_first() -> None:
    assert heading_of(top_section("can I cancel anytime")) == "7.2 Cancellation"


def test_other_questions_find_their_clause() -> None:
    assert heading_of(top_section("What happens if I miss a payment?")) in {
        "5.1 Late fee",
        "5.2 Bounce charge",
        "5.3 Overdue interest",
        "5.4 Credit reporting",
    }
    assert heading_of(top_section("How are disputes resolved?")) in {
        "10.1 Arbitration",
        "10.2 Seat of arbitration",
    }
    assert heading_of(top_section("Can I repay the loan early?")) in {
        "6.1 Foreclosure lock-in",
        "6.2 Foreclosure charge",
        "6.3 Part-prepayment",
    }
    assert heading_of(top_section("Is the processing fee refundable?")) == "3.2 Processing fee"


def test_long_sections_are_chunked_with_overlap() -> None:
    text = " ".join(f"word{n}" for n in range(800))
    section = PreparedSection(id="s-1", heading="Long", level=2, text=text, order=0)
    chunks = chunk_sections([section])
    assert len(chunks) > 1
    assert all(chunk.section_id == "s-1" for chunk in chunks)
    assert all(len(chunk.text) <= CHUNK_CHARS for chunk in chunks)
    assert chunks[0].text[-200:] == chunks[1].text[:200]


def test_empty_page_has_no_results() -> None:
    assert SectionIndex([]).search("anything") == []
