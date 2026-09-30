"""Page-type rules (with rule 3b after privacy)."""

from app.schemas.snapshot import PageSnapshot
from app.services.pages import long_sections, rule_page_type
from tests.helpers import load_snapshot


def with_changes(name: str, **changes: object) -> PageSnapshot:
    data = load_snapshot(name)
    data.update(changes)
    return PageSnapshot.model_validate(data)


def numbered_sections(count: int) -> list[dict[str, object]]:
    return [
        {"id": f"s-{n}", "heading": f"{n}.1 Clause {n}", "level": 3, "text": "Some text."}
        for n in range(1, count + 1)
    ]


def test_numbered_headings_make_terms_when_url_says_nothing() -> None:
    page = with_changes(
        "terms",
        url="https://lender.example/legal/doc",
        title="Loan document",
        sections=numbered_sections(6),
    )
    assert rule_page_type(page) == "terms"


def test_numbered_privacy_policy_stays_privacy() -> None:
    page = with_changes("privacy", sections=numbered_sections(8))
    assert rule_page_type(page) == "privacy"


def test_checkout_needs_two_prices() -> None:
    data = load_snapshot("checkout")
    data["prices"] = data["prices"][:1]
    data["url"] = "https://shop.example/basket"
    page = PageSnapshot.model_validate(data)
    assert rule_page_type(page) != "checkout"


def test_checkout_found_by_heading() -> None:
    page = with_changes("checkout", url="https://shop.example/step-3")
    assert rule_page_type(page) == "checkout"


def test_repayment_heading_is_not_checkout() -> None:
    data = load_snapshot("offer")
    data["url"] = "https://lender.example/"
    data["sections"][2]["heading"] = "Repayment schedule"
    data["prices"].append(dict(data["prices"][0], id="i-9"))
    assert rule_page_type(PageSnapshot.model_validate(data)) == "offer"


def test_plain_pages_have_no_rule_type() -> None:
    long_text = "word " * 120
    page = with_changes(
        "offer",
        url="https://blog.example/post",
        title="A post",
        prices=[],
        client_flags=[],
        sections=[
            {"id": f"s-{n}", "heading": None, "level": None, "text": long_text} for n in range(1, 4)
        ],
    )
    assert rule_page_type(page) is None
    assert long_sections(page) == 3
