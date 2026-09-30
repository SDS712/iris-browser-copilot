"""Quote verification: exact, normalised, fuzzy-fixed and rejected quotes."""

from app.services.grounding import find_quote, verify_quote
from app.services.pages import PreparedSection

CLAUSE = (
    "You may cancel QuickCred Plus by giving 30 days' written notice to "
    "support@quickcred.example. A cancellation fee of ₹499 applies if you cancel "
    "within the first six months."
)


def test_exact_quote() -> None:
    quote = "A cancellation fee of ₹499 applies"
    assert verify_quote(CLAUSE, quote) == quote


def test_whitespace_case_and_quote_marks_are_normalised() -> None:
    quote = "you may cancel quickcred plus by   giving 30 days’ written notice"
    assert verify_quote(CLAUSE, quote) == (
        "You may cancel QuickCred Plus by giving 30 days' written notice"
    )


def test_dashes_are_unified() -> None:
    text = "Fees — including GST – are shown below."
    assert (
        verify_quote(text, "fees - including gst - are shown") == "Fees — including GST – are shown"
    )


def test_surrounding_quote_marks_and_ellipsis_are_ignored() -> None:
    assert verify_quote(CLAUSE, '"A cancellation fee of ₹499 applies…"') == (
        "A cancellation fee of ₹499 applies"
    )


def test_small_typo_is_fixed_to_the_page_text() -> None:
    quote = "A cancelation fee of ₹499 applies if you cancel within the first six months"
    verified = verify_quote(CLAUSE, quote)
    assert verified is not None
    assert "cancellation fee of ₹499" in verified
    assert verified in CLAUSE


def test_made_up_quote_is_rejected() -> None:
    assert verify_quote(CLAUSE, "There is no fee to cancel at any time.") is None
    assert verify_quote(CLAUSE, "₹999") is None
    assert verify_quote(CLAUSE, "") is None


def test_long_quote_is_clipped_to_220_characters() -> None:
    text = "word " * 100
    verified = verify_quote(text, text.strip())
    assert verified is not None
    assert len(verified) <= 220


def test_find_quote_checks_other_sections() -> None:
    sections = {
        "s-1": PreparedSection("s-1", "Intro", 2, "Welcome to the terms.", 0),
        "s-2": PreparedSection("s-2", "7.2 Cancellation", 3, CLAUSE, 1),
    }
    assert find_quote(sections, "s-1", "written notice to support")[0] == "s-2"
    assert find_quote(sections, "s-9", "Welcome to the terms") == ("s-1", "Welcome to the terms")
    assert find_quote(sections, "s-1", "nothing like this") is None
    assert find_quote(sections, "s-1", None) is None
