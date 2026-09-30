"""summary_for_agent: the format, the 1,500-character limit, (+N more), no queries."""

from app.schemas.snapshot import PageSnapshot
from app.services.pages import SUMMARY_LIMIT, build_summary
from tests.helpers import load_snapshot, snapshot_model


def test_checkout_summary_format() -> None:
    summary = build_summary(snapshot_model("checkout"), "checkout")
    lines = summary.splitlines()
    assert lines[0] == "PAGE: Checkout – QuickCred example (type: checkout)"
    assert lines[1] == "URL: https://iris.example.com/demo/checkout"
    assert lines[2] == "FIELDS: none"
    assert lines[3] == (
        'CHOICES: i-20 "Protect your purchase: QuickCred Shield ₹1,299/year" [pre-checked]; '
        'i-21 "QuickCred Plus: free for 30 days, then ₹199/month" [pre-checked]; '
        'i-22 "Extended warranty (2 years) ₹2,499"'
    )
    assert lines[4].startswith('PRICES: i-31 "Nimbus 14 laptop" ₹59,999; ')
    assert lines[5] == 'SECTIONS: s-1 "Your order"; s-2 "Review & pay"'
    assert lines[6] == 'LEGAL LINKS: i-40 "Terms"; i-41 "Privacy"'
    assert lines[7] == "COOKIE BANNER: yes (reject hidden)"
    assert lines[8] == (
        "FLAGS: prechecked_paid_addon i-20 (high); trial_to_paid i-21 (high); "
        "hidden_cookie_reject i-50 (info)"
    )


def test_late_price_is_marked() -> None:
    data = load_snapshot("checkout")
    data["prices"].append(
        {
            "id": "i-35",
            "label": "Convenience fee",
            "amount_text": "₹49",
            "amount_inr": 49,
            "first_seen_revision": 2,
        }
    )
    summary = build_summary(PageSnapshot.model_validate(data), "checkout")
    assert 'i-35 "Convenience fee" ₹49 [appeared later]' in summary


def test_url_line_drops_query_and_fragment() -> None:
    summary = build_summary(snapshot_model("terms"), "terms")
    assert "URL: https://iris.example.com/demo/terms\n" in summary
    assert "utm_source" not in summary
    assert "?" not in summary.splitlines()[1]


def test_long_pages_are_trimmed_with_more_marker() -> None:
    data = load_snapshot("terms")
    data["sections"] = [
        {
            "id": f"s-{n}",
            "heading": f"{n}.1 A fairly long clause heading number {n}",
            "level": 3,
            "text": "Text.",
        }
        for n in range(1, 120)
    ]
    data["client_flags"] = load_snapshot("checkout")["client_flags"]
    summary = build_summary(PageSnapshot.model_validate(data), "terms")
    assert len(summary) <= SUMMARY_LIMIT
    sections_line = next(line for line in summary.splitlines() if line.startswith("SECTIONS:"))
    assert sections_line.endswith("more)")
    assert "(+" in sections_line
    # Flags are never trimmed.
    assert "hidden_cookie_reject i-50 (info)" in summary


def test_longest_list_is_trimmed_first() -> None:
    data = load_snapshot("form")
    data["sections"] = [
        {
            "id": f"s-{n}",
            "heading": f"Heading {n} with some extra words to make it long",
            "level": 2,
            "text": "x",
        }
        for n in range(1, 80)
    ]
    summary = build_summary(PageSnapshot.model_validate(data), "form")
    assert len(summary) <= SUMMARY_LIMIT
    fields_line = next(line for line in summary.splitlines() if line.startswith("FIELDS:"))
    assert "more)" not in fields_line
