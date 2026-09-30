"""Spoken lines: stripping, the sentence limit, speakable amounts and acronyms."""

from app.services.say import finalise, limit_length, speakable, strip_unspeakable


def test_ids_urls_and_markdown_are_removed() -> None:
    text = "**Heads up**: see [the terms](https://x.example/terms) (s-7) and i-20 at https://q.example."
    assert strip_unspeakable(text) == "Heads up: see the terms and at."
    assert strip_unspeakable("Risk r-2 is `important`") == "Risk is important"


def test_section_numbers_are_removed_but_figures_stay() -> None:
    assert (
        strip_unspeakable("Under section 7.2, you can cancel.")
        == "Under the section, you can cancel."
    )
    assert strip_unspeakable("Clause 5.1 says so.") == "the clause says so."
    assert strip_unspeakable("It's 1.5% a month flat, or 36.5% a year.") == (
        "It's 1.5% a month flat, or 36.5% a year."
    )
    assert strip_unspeakable("An EMI of ₹5,899.90 and 1.5 times the EMI.") == (
        "An EMI of ₹5,899.90 and 1.5 times the EMI."
    )
    assert strip_unspeakable("See 7.2 for details.") == "See for details."


def test_two_statements_and_the_offer_are_kept() -> None:
    text = (
        "Yes, you can cancel with 30 days' notice. Heads up, it costs ₹499 if you cancel "
        "in the first six months. Want me to show you the clause?"
    )
    assert limit_length(text) == text


def test_third_statement_is_dropped() -> None:
    text = "One. Two. Three. Want more?"
    assert limit_length(text) == "One. Two. Want more?"


def test_word_limit_drops_whole_sentences() -> None:
    long_sentence = "This " + " ".join(["word"] * 41) + "."
    text = f"Short answer here. {long_sentence} Want the details?"
    assert limit_length(text) == "Short answer here. Want the details?"


def test_single_long_sentence_is_cut() -> None:
    text = " ".join(["word"] * 60) + "."
    result = limit_length(text)
    assert len(result.split()) <= 45
    assert result.endswith(".")


def test_finalise_capitalises_after_stripping() -> None:
    assert finalise("s-3 the page says so.") == "The page says so."


def test_speakable_amounts() -> None:
    assert speakable("It costs ₹4,999.") == "It costs 4,999 rupees."
    assert speakable("A loan of ₹1,00,000.") == "A loan of one lakh rupees."
    assert speakable("Up to ₹2,50,000 today.") == "Up to 2.5 lakh rupees today."
    assert speakable("₹1,00,00,000 limit") == "one crore rupees limit"
    assert speakable("EMI ₹5,899.90") == "E-M-I 5,899.90 rupees"


def test_speakable_acronyms() -> None:
    assert speakable("NACH and UPI AutoPay, IFSC, GST, APR") == (
        "N-A-C-H and U-P-I AutoPay, I-F-S-C, G-S-T, A-P-R"
    )
    assert speakable("NACHO stays") == "NACHO stays"


def test_finalise_speakable_setting() -> None:
    assert (
        finalise("It costs ₹499 plus GST.", speakable_say=True) == "It costs 499 rupees plus G-S-T."
    )
    assert finalise("It costs ₹499 plus GST.") == "It costs ₹499 plus GST."
